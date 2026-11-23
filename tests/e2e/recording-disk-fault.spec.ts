import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { notices } from './hall-looks';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream } from './stream-helpers';

// Native worker + Main + real operator notice. Only the test-owned worker's filesystem calls fail;
// no disk is filled and no internet stream is opened. Unit tests separately cover encoder recovery.
for (const fault of ['sync-ENOSPC', 'sync-EIO', 'open-ENOSPC', 'write-ENOSPC', 'part-ENOSPC']) {
  test(`recording reports ${fault} to the operator and keeps earlier bytes`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-x87-disk-'));
    const arm = join(dir, 'fault-armed');
    const hit = join(dir, 'fault-hit');
    const wrapper = join(dir, 'disk-worker.cjs');
    writeFileSync(
      wrapper,
      `
const fs = require('node:fs');
const fault = ${JSON.stringify(fault)};
const armed = () => fs.existsSync(${JSON.stringify(arm)});
const failure = () => { fs.writeFileSync(${JSON.stringify(hit)}, fault); return Object.assign(new Error('Generated disk fault'), { code: fault.endsWith('EIO') ? 'EIO' : 'ENOSPC' }); };
const sync = fs.fdatasync;
fs.fdatasync = function(fd, done) { if (armed() && fault.startsWith('sync-')) return done(failure()); return sync(fd, done); };
const open = fs.openSync;
fs.openSync = function(file, flags, ...rest) {
  if (armed() && String(file).endsWith('.mkv') && flags === 'wx' && (fault === 'open-ENOSPC' || (fault === 'part-ENOSPC' && String(file).includes(' part ')))) throw failure();
  return open(file, flags, ...rest);
};
const write = fs.WriteStream.prototype._write;
fs.WriteStream.prototype._write = function(chunk, encoding, done) {
  if (armed() && fault === 'write-ENOSPC' && String(this.path).endsWith('.mkv')) return done(failure());
  return write.call(this, chunk, encoding, done);
};
require('node:module').syncBuiltinESMExports();
require(process.argv.at(-1));
`,
    );
    const { app } = await launchApp({
      DRASHTI_TEST_FAKE_DEVICES: '1',
      DRASHTI_TEST_RECORD_PART_BYTES: '100000',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await app.evaluate(({ utilityProcess }, path) => {
        const fork = utilityProcess.fork.bind(utilityProcess);
        utilityProcess.fork = (modulePath, args, options) =>
          modulePath.endsWith('stream-worker.js')
            ? fork(path, [...(args ?? []), modulePath], options)
            : fork(modulePath, args, options);
      }, wrapper);
      await setUpStream(app, win, await freePort(), dir, false);
      const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
      if (fault === 'open-ENOSPC') writeFileSync(arm, 'generated fault');
      expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
        true,
      );
      let earlier: { file: string; bytes: Buffer } | undefined;
      if (fault !== 'open-ENOSPC') {
        await expect.poll(async () => (await status()).recording.bytes).toBeGreaterThan(10000);
        if (fault === 'part-ENOSPC') {
          await expect
            .poll(() => readdirSync(dir).filter((file) => file.endsWith('.mkv')).length)
            .toBeGreaterThanOrEqual(2);
          const file = readdirSync(dir).find((file) => file.endsWith('.mkv') && !file.includes(' part '));
          if (!file) throw new Error('No earlier recording part');
          earlier = { file: join(dir, file), bytes: readFileSync(join(dir, file)) };
        }
        writeFileSync(arm, 'generated fault');
      }
      await expect
        .poll(() => {
          try {
            return readFileSync(hit, 'utf8');
          } catch {
            return '';
          }
        })
        .toBe(fault);
      await expect.poll(async () => (await status()).recording.state).toBe('off');
      const cause = fault === 'sync-EIO' ? 'disk could not keep what was written' : 'disk is full';
      expect((await status()).recording.message).toContain(cause);
      await expect.poll(async () => (await notices(win)).join(' ')).toContain(cause);
      if (earlier) expect(readFileSync(earlier.file)).toEqual(earlier.bytes);
    } finally {
      await app.close();
    }
  });
}
