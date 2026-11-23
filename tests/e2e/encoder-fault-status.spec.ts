import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream } from './stream-helpers';

// Real worker and FFmpeg recovery, generated inputs, recording only. Observe every status forwarded
// to Main so a quick recovery cannot hide whether the initial fault was ever delivered.
for (const fault of ['exit', 'spawn-error']) {
  test(`an encoder ${fault} reports failure before recording resumes in a new part`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-x87-encoder-'));
    const wrapper = join(dir, 'encoder-worker.cjs');
    writeFileSync(
      wrapper,
      `
const cp = require('node:child_process');
const spawn = cp.spawn;
let failed = false;
cp.spawn = function(file, args, options) {
  if (!failed && args.includes('pipe:1') && args.includes('-cluster_time_limit')) {
    failed = true;
    if (${JSON.stringify(fault)} === 'spawn-error') return spawn(${JSON.stringify(join(dir, 'missing-generated-encoder'))}, args, options);
    const child = spawn(file, args, options);
    child.once('spawn', () => child.kill('SIGKILL'));
    return child;
  }
  return spawn(file, args, options);
};
require('node:module').syncBuiltinESMExports();
require(process.argv.at(-1));
`,
    );
    const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await app.evaluate(({ utilityProcess }, path) => {
        const fork = utilityProcess.fork.bind(utilityProcess);
        const reports: { encoding: boolean; error: string | null }[] = [];
        (globalThis as { x87EncoderReports?: typeof reports }).x87EncoderReports = reports;
        utilityProcess.fork = (modulePath, args, options) => {
          if (!modulePath.endsWith('stream-worker.js')) return fork(modulePath, args, options);
          const child = fork(path, [...(args ?? []), modulePath], options);
          child.on('message', (message: unknown) => {
            const m = message as { type?: string; status?: { encoding: boolean; error: string | null } };
            if (m.type === 'status' && m.status) reports.push(m.status);
          });
          return child;
        };
      }, wrapper);
      await setUpStream(app, win, await freePort(), dir, false);
      expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
        true,
      );
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (
                globalThis as { x87EncoderReports?: { encoding: boolean; error: string | null }[] }
              ).x87EncoderReports?.some((s) => !s.encoding && s.error?.includes('encoder')) ?? false,
          ),
        )
        .toBe(true);
      const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
      await expect.poll(async () => (await status()).recording.file).toContain(' part 2.mkv');
      await expect.poll(async () => (await status()).recording.bytes).toBeGreaterThan(10000);
      expect((await status()).error).toBeNull();
    } finally {
      await app.close();
    }
  });
}
