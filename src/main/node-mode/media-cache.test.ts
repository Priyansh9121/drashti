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
  options: { free?: number; now?: () => number; inUse?: () => string[] } = {},
) {
  dir ||= mkdtempSync(join(tmpdir(), 'drashti-cache-'));
  return new MediaCache({
    dir,
    open: main.open,
    online: () => true,
    inUse: options.inUse ?? (() => []),
    changed: () => undefined,
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
});
