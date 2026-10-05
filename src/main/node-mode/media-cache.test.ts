import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaWant } from '../../shared/nodes';
import { MediaCache } from './media-cache';

/* A node's copies of Main's media (made-up files only). */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const GiB = 1024 * 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Main, as the cache asks it for files: these bytes by id (or wrong bytes, to see the hash refuse them). */
function fakeMain(files: Record<string, { bytes: Buffer; ext: string; lie?: boolean }>) {
  const asked: { id: string; from: number }[] = [];
  const open = (id: string, from: number): Promise<IncomingMessage> => {
    asked.push({ id, from });
    const f = files[id];
    const res = new PassThrough() as unknown as IncomingMessage & PassThrough;
    if (!f) {
      Object.assign(res, { statusCode: 404, headers: {} });
      (res as PassThrough).end();
      return Promise.resolve(res);
    }
    const body = f.lie ? Buffer.alloc(f.bytes.length, 1) : f.bytes;
    Object.assign(res, {
      statusCode: from > 0 ? 206 : 200,
      headers: {
        'x-drashti-sha256': sha(f.bytes),
        'x-drashti-ext': f.ext,
        'content-length': String(f.bytes.length - from),
      },
    });
    (res as PassThrough).end(body.subarray(from));
    return Promise.resolve(res);
  };
  return { open, asked };
}

function cache(
  main: ReturnType<typeof fakeMain>,
  options: {
    free?: number;
    now?: () => number;
    inUse?: () => string[];
    online?: () => boolean;
    landed?: (id: string) => void;
  } = {},
) {
  dir ||= mkdtempSync(join(tmpdir(), 'drashti-cache-'));
  return new MediaCache({
    dir,
    open: main.open,
    online: options.online ?? (() => true),
    inUse: options.inUse ?? (() => []),
    changed: () => undefined,
    landed: options.landed,
    log: () => undefined,
    freeBytes: () => options.free ?? 100 * GiB,
    now: options.now,
  });
}

const want = (id: string, bytes: Buffer, ext = 'jpg'): MediaWant => ({
  id,
  sha256: sha(bytes),
  bytes: bytes.length,
  ext,
});

describe('a node’s media copies', () => {
  it('copies what Main wants, in order, each checked by its hash, named by it', async () => {
    const a = Buffer.from('placeholder picture a');
    const b = Buffer.from('placeholder video b');
    const main = fakeMain({ a: { bytes: a, ext: 'jpg' }, b: { bytes: b, ext: 'mp4' } });
    const c = cache(main);
    c.setWanted([want('a', a), want('b', b, 'mp4')]);
    await expect.poll(() => c.status(0).ready).toBe(2);
    expect(main.asked.map((x) => x.id)).toEqual(['a', 'b']);
    expect(c.pathFor('b')).toBe(join(dir, `${sha(b)}.mp4`));
    expect(readFileSync(c.pathFor('a') ?? '')).toEqual(a);
    expect(c.status(0)).toMatchObject({
      wanted: 2,
      ready: 2,
      bytesWanted: a.length + b.length,
      problem: null,
    });
  });

  it('fetches what is on the screens at once, even before Main lists it', async () => {
    const live = Buffer.from('placeholder live picture');
    const main = fakeMain({ live: { bytes: live, ext: 'png' } });
    const c = cache(main);
    expect(await c.ensure('live')).toBe(join(dir, `${sha(live)}.png`));
    expect(c.has('live')).toBe(true);
    expect(await c.ensure('nothing-like-it')).toBeNull();
  });

  it('never keeps a copy that does not match its hash', async () => {
    const a = Buffer.from('placeholder picture a');
    const main = fakeMain({ a: { bytes: a, ext: 'jpg', lie: true } });
    const c = cache(main);
    expect(await c.ensure('a')).toBeNull();
    expect(c.has('a')).toBe(false);
    expect(existsSync(join(dir, `${sha(a)}.jpg`))).toBe(false);
  });

  it('carries on an interrupted copy from where it stopped', async () => {
    const a = Buffer.alloc(50_000, 3);
    const main = fakeMain({ a: { bytes: a, ext: 'jpg' } });
    dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'));
    mkdirSync(join(dir, '.part'), { recursive: true });
    writeFileSync(join(dir, '.part', 'a'), a.subarray(0, 20_000));
    const c = cache(main);
    expect(await c.ensure('a')).not.toBeNull();
    expect(main.asked).toEqual([{ id: 'a', from: 20_000 }]);
    expect(readFileSync(c.pathFor('a') ?? '')).toEqual(a);
  });

  it('keeps 2 GB free, and says so', async () => {
    const big = Buffer.alloc(1000, 5);
    const main = fakeMain({ big: { bytes: big, ext: 'mp4' } });
    const c = cache(main, { free: 2 * GiB + 500 });
    c.setWanted([want('big', big, 'mp4')]);
    await expect.poll(() => c.status(0).problem).toContain('keep 2 GB free');
    expect(c.has('big')).toBe(false);
  });

  it('removes copies nothing has wanted for 30 days, never one on the screens', async () => {
    let now = Date.parse('2026-10-05T10:00:00Z');
    const a = Buffer.from('placeholder a');
    const b = Buffer.from('placeholder b');
    const main = fakeMain({ a: { bytes: a, ext: 'jpg' }, b: { bytes: b, ext: 'jpg' } });
    let shown: string[] = [];
    const c = cache(main, { now: () => now, inUse: () => shown });
    c.setWanted([want('a', a), want('b', b)]);
    await expect.poll(() => c.status(0).ready).toBe(2);
    now += 31 * 24 * 3600 * 1000;
    shown = ['b'];
    c.setWanted([]);
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
  });

  it('a screen waits for a copy for as long as it is on the screens, past a copy that broke off', async () => {
    const a = Buffer.from('placeholder clip that breaks off once');
    const main = fakeMain({ a: { bytes: a, ext: 'mp4' } });
    let broken = false;
    const open = main.open;
    const landed: string[] = [];
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      // The first try fails as a dropped connection would; the next one works.
      open: (id, from) => {
        if (!broken) {
          broken = true;
          return Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        }
        return open(id, from);
      },
      online: () => true,
      inUse: () => ['a'],
      changed: () => undefined,
      landed: (id) => landed.push(id),
      log: () => undefined,
      freeBytes: () => 100 * GiB,
    });
    expect(await c.ensure('a')).toBe(join(dir, `${sha(a)}.mp4`));
    expect(landed).toEqual(['a']);
  });

  it('a screen stops waiting once the file is off the screens, or Main cannot be reached', async () => {
    // A copy that never finishes: Main sends the start of the file and no more.
    const slow = (): Promise<IncomingMessage> => {
      const res = new PassThrough() as unknown as IncomingMessage & PassThrough;
      Object.assign(res, {
        statusCode: 200,
        headers: { 'x-drashti-sha256': 'a'.repeat(64), 'x-drashti-ext': 'mp4', 'content-length': '1000000' },
      });
      (res as PassThrough).write(Buffer.alloc(10));
      return Promise.resolve(res);
    };
    let shown = ['small', 'big'];
    let online = true;
    const small = Buffer.from('placeholder small picture');
    const main = fakeMain({ small: { bytes: small, ext: 'png' } });
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      open: (id, from) => (id === 'big' ? slow() : main.open(id, from)),
      online: () => online,
      inUse: () => shown,
      changed: () => undefined,
      log: () => undefined,
      freeBytes: () => 100 * GiB,
    });
    const smallPath = await c.ensure('small');
    expect(smallPath).toBe(join(dir, `${sha(small)}.png`));
    const waiting = c.ensure('big');
    // While a screen waits for one file, one that is here is answered at once.
    const asked = Date.now();
    expect(await c.ensure('small')).toBe(smallPath);
    expect(Date.now() - asked).toBeLessThan(50);
    const started = Date.now();
    shown = ['small'];
    expect(await waiting).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
    // And offline: let go too.
    shown = ['big'];
    online = false;
    expect(await c.ensure('big')).toBeNull();
    // Closing stops the copy that never ends (and lets go of its file).
    await c.close();
  });

  it('tries a file on the screens again soon, with no screen waiting for it', async () => {
    const a = Buffer.from('placeholder clip on the screens');
    const main = fakeMain({ a: { bytes: a, ext: 'mp4' } });
    let fails = 1;
    const landed: string[] = [];
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      open: (id, from) =>
        fails-- > 0
          ? Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
          : main.open(id, from),
      online: () => true,
      inUse: () => ['a'],
      changed: () => undefined,
      landed: (id) => landed.push(id),
      log: () => undefined,
      freeBytes: () => 100 * GiB,
    });
    const started = Date.now();
    c.setWanted([want('a', a, 'mp4')]);
    await expect.poll(() => landed, { timeout: 5000 }).toEqual(['a']);
    // The short wait (2 s), not the long one (15 s).
    expect(Date.now() - started).toBeLessThan(4000);
    await c.close();
  });

  it('once Main is back, what failed while it was away is copied at once', async () => {
    const a = Buffer.from('placeholder clip cut off by Main going away');
    const main = fakeMain({ a: { bytes: a, ext: 'mp4' } });
    let online = true;
    let away = true;
    let tries = 0;
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      open: (id, from) => {
        tries++;
        if (!away) return main.open(id, from);
        online = false;
        return Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
      },
      online: () => online,
      // Not on the screens: the long wait (15 s) would apply.
      inUse: () => [],
      changed: () => undefined,
      log: () => undefined,
      freeBytes: () => 100 * GiB,
    });
    c.setWanted([want('a', a, 'mp4')]);
    await expect.poll(() => tries).toBe(1);
    away = false;
    online = true;
    const back = Date.now();
    c.backOnline();
    await expect.poll(() => c.has('a'), { timeout: 3000 }).toBe(true);
    expect(Date.now() - back).toBeLessThan(1000);
    await c.close();
  });

  it('a retry whose timer fires a moment early looks again at once, not after another whole wait', async () => {
    const a = Buffer.from('placeholder clip tried again');
    const main = fakeMain({ a: { bytes: a, ext: 'mp4' } });
    let fails = 1;
    // After the failure is noted, this clock runs 30 ms behind the timers' own: every timer
    // seems to fire 30 ms before its time.
    let behind = 0;
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      open: (id, from) => {
        if (fails-- > 0) {
          setTimeout(() => (behind = 30), 0);
          return Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        }
        return main.open(id, from);
      },
      online: () => true,
      inUse: () => ['a'],
      changed: () => undefined,
      log: () => undefined,
      freeBytes: () => 100 * GiB,
      now: () => Date.now() - behind,
    });
    const started = Date.now();
    c.setWanted([want('a', a, 'mp4')]);
    await expect.poll(() => c.has('a'), { timeout: 6000 }).toBe(true);
    // About 2 s after the failure (and 30 ms), never 2 s more.
    expect(Date.now() - started).toBeLessThan(3500);
    await c.close();
  });

  it('a copy for later gives way to a file the screens need, and carries on from where it stopped', async () => {
    const big = Buffer.alloc(64 * 1024, 7);
    const small = Buffer.from('placeholder picture put up now');
    const main = fakeMain({ small: { bytes: small, ext: 'png' } });
    const bigAsked: number[] = [];
    // The big file comes slowly: its first 1000 bytes, then the rest only on a later request.
    const open = (id: string, from: number): Promise<IncomingMessage> => {
      if (id !== 'big') return main.open(id, from);
      bigAsked.push(from);
      const res = new PassThrough() as unknown as IncomingMessage & PassThrough;
      Object.assign(res, {
        statusCode: from > 0 ? 206 : 200,
        headers: {
          'x-drashti-sha256': sha(big),
          'x-drashti-ext': 'mp4',
          'content-length': String(big.length - from),
        },
      });
      if (from > 0) (res as PassThrough).end(big.subarray(from));
      else (res as PassThrough).write(big.subarray(0, 1000));
      return Promise.resolve(res);
    };
    let shown: string[] = [];
    const c = new MediaCache({
      dir: (dir = mkdtempSync(join(tmpdir(), 'drashti-cache-'))),
      open,
      online: () => true,
      inUse: () => shown,
      changed: () => undefined,
      log: () => undefined,
      freeBytes: () => 100 * GiB,
    });
    c.setWanted([want('big', big, 'mp4'), want('small', small, 'png')]);
    await expect.poll(() => c.status(0).copying?.done ?? 0).toBe(1000);
    // The picture goes up: the big copy gives way, and the screen's request is answered at once.
    shown = ['small'];
    const asked = Date.now();
    expect(await c.ensure('small')).toBe(join(dir, `${sha(small)}.png`));
    expect(Date.now() - asked).toBeLessThan(1000);
    // Then the big file carries on from its 1000th byte, and lands whole.
    await expect.poll(() => c.has('big'), { timeout: 3000 }).toBe(true);
    expect(bigAsked).toEqual([0, 1000]);
    await c.close();
  });
});
