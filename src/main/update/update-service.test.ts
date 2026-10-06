import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateManifest, UpdateView } from '../../shared/updates';
import { RateGate } from '../rate-gate';
import { downloadFile } from './download';
import type { Installer } from './installer';
import { UpdateService } from './update-service';

/* Updates against a server on this computer (made-up files, never a real installer). */

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A release server: the manifest at GitHub's paths, and files that honour ranges. */
async function releases(files: Record<string, Buffer>, manifest: (base: string) => UpdateManifest | null) {
  let served = 0;
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const url = req.url ?? '';
    if (url.endsWith('/drashti-update.json')) {
      const m = manifest(base);
      if (!m) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(m));
      return;
    }
    const name = url.split('/').pop() ?? '';
    const body = files[name];
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = /bytes=(\d+)-/u.exec(req.headers.range ?? '');
    const from = range ? Number(range[1]) : 0;
    res.writeHead(range ? 206 : 200, { 'content-length': body.length - from });
    served += body.length - from;
    res.end(body.subarray(from));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return { base, served: () => served };
}

const sha = (b: Buffer) => createHash('sha512').update(b).digest('base64');

function manifestFor(base: string, version: string, name: string, body: Buffer): UpdateManifest {
  return {
    app: 'drashti',
    version,
    releasedAt: '2026-10-06T00:00:00Z',
    notes: 'Placeholder notes.',
    source: `${base}/source`,
    files: [
      {
        platform: 'win32',
        arch: 'x64',
        kind: 'nsis',
        name,
        url: `${base}/files/${name}`,
        size: body.length,
        sha512: sha(body),
      },
    ],
  };
}

function service(base: string, extra: { onAir?: () => boolean; current?: string } = {}) {
  const installed: string[] = [];
  const views: UpdateView[] = [];
  const installer: Installer = {
    mode: 'at-quit',
    prepare: () => Promise.resolve({ ok: true }),
    atQuit: (file) => {
      installed.push(file);
      return { ok: true };
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'drashti-updates-'));
  let auto = false;
  const make = () =>
    new UpdateService({
      current: extra.current ?? '1.0.0',
      platform: 'win32',
      arch: 'x64',
      base,
      dir,
      fetch: (url, init) => fetch(url, init),
      installer,
      onAir: extra.onAir ?? (() => false),
      autoCheck: {
        get: () => auto,
        set: (on) => {
          auto = on;
        },
      },
      now: Date.now,
      changed: (v) => views.push(v),
      log: () => undefined,
      bytesPerSecond: 50 * 1024 * 1024,
    });
  return { make, installed, views, dir };
}

const until = async (test: () => boolean) => {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(test()).toBe(true);
};

describe('updates', () => {
  it('offer a newer release, download and check it, and install only at quit when told', async () => {
    const body = Buffer.alloc(300_000, 7);
    const r = await releases({ 'Drashti-1.0.1-setup-x64.exe': body }, (base) =>
      manifestFor(base, '1.0.1', 'Drashti-1.0.1-setup-x64.exe', body),
    );
    const t = service(r.base);
    const u = t.make();
    const checked = await u.check();
    expect(checked.ok && checked.view).toMatchObject({
      phase: 'available',
      offer: { version: '1.0.1', size: body.length },
    });
    u.download();
    await until(() => u.view().phase === 'ready');
    // Downloaded, but nothing installs until an admin says so, and then only at quit.
    u.quit();
    expect(t.installed).toEqual([]);
    expect((await u.setInstallOnQuit(true)).ok).toBe(true);
    expect(u.view().installOnQuit).toBe(true);
    // The say-so is kept over a restart.
    const again = t.make();
    expect(again.view()).toMatchObject({ phase: 'ready', installOnQuit: true });
    again.quit();
    expect(t.installed).toHaveLength(1);
    expect(readFileSync(t.installed[0] ?? '').equals(body)).toBe(true);
  });

  it('say when it is up to date, or when nothing is published', async () => {
    const body = Buffer.alloc(10, 1);
    const r = await releases({}, (base) => manifestFor(base, '1.0.0', 'x.exe', body));
    const view = (await service(r.base).make().check()) as { ok: true; view: UpdateView };
    expect(view.view.phase).toBe('up-to-date');
    const none = await releases({}, () => null);
    const v2 = (await service(none.base).make().check()) as { ok: true; view: UpdateView };
    expect(v2.view).toMatchObject({ phase: 'up-to-date', message: 'No release has been published yet.' });
  });

  it('wait while the stream is on air, and go on afterwards', async () => {
    const body = Buffer.alloc(200_000, 3);
    const r = await releases({ 'Drashti-1.0.2-setup-x64.exe': body }, (base) =>
      manifestFor(base, '1.0.2', 'Drashti-1.0.2-setup-x64.exe', body),
    );
    let onAir = true;
    const t = service(r.base, { onAir: () => onAir });
    const u = t.make();
    await u.check();
    u.download();
    await until(() => u.view().phase === 'waiting');
    expect(u.view().waitingFor).toBe('the stream is on air or recording');
    expect(r.served()).toBe(0);
    onAir = false;
    await until(() => u.view().phase === 'ready');
  }, 15_000);

  it('match a node to Main: one version, older or newer', async () => {
    const body = Buffer.alloc(1000, 5);
    const r = await releases({ 'Drashti-0.9.0-setup-x64.exe': body }, (base) =>
      manifestFor(base, '0.9.0', 'Drashti-0.9.0-setup-x64.exe', body),
    );
    const u = service(r.base).make();
    const r2 = (await u.check('0.9.0')) as { ok: true; view: UpdateView };
    expect(r2.view).toMatchObject({ phase: 'available', offer: { version: '0.9.0' } });
  });
});

describe('downloading', () => {
  it('carries on from where it stopped, and throws away a file that fails its checksum', async () => {
    const body = Buffer.alloc(100_000, 9);
    const r = await releases({ 'a.zip': body, 'bad.zip': Buffer.alloc(100_000, 1) }, () => null);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    let stopAt = 40_000;
    const opts = (name: string) => ({
      url: `${r.base}/files/${name}`,
      dest: join(dir, name),
      size: body.length,
      sha512: sha(body),
      fetch: (url: string, init: { headers: Record<string, string> }) => fetch(url, init),
      rate: new RateGate(100 * 1024 * 1024),
      gate: () => Promise.resolve(),
      cancelled: () => false,
      progress: () => undefined,
    });
    let seen = 0;
    await expect(
      downloadFile({
        ...opts('a.zip'),
        progress: (done) => {
          seen = done;
        },
        cancelled: () => seen >= stopAt,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(existsSync(join(dir, 'a.zip.part'))).toBe(true);
    const before = r.served();
    stopAt = Infinity;
    await downloadFile(opts('a.zip'));
    expect(readFileSync(join(dir, 'a.zip')).equals(body)).toBe(true);
    // The second time asked only for the rest.
    expect(r.served() - before).toBeLessThan(body.length);
    await expect(downloadFile(opts('bad.zip'))).rejects.toMatchObject({ code: 'checksum' });
    expect(existsSync(join(dir, 'bad.zip.part'))).toBe(false);
    expect(existsSync(join(dir, 'bad.zip'))).toBe(false);
  });
});
