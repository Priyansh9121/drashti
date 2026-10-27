import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_LINK_MS } from '../../shared/device-pictures';
import { MediaLinks, sendFile } from './media-serving';

/*
 * A media file sent to a phone in pieces as it plays (Session 54, D1): HTTP Range as a <video> asks for it, an
 * unchanged file answered without being sent again, and links that work for one device, one file and a while.
 * Made-up bytes and ids only.
 */

let dir = '';
let server: Server | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-media-serving-'));
});
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

/** A server sending `file` (or saying it is not there), and a request to it with these headers. */
async function serve(file: string, tag?: string) {
  server = createServer((req, res) => {
    void sendFile(
      req,
      res,
      { path: file, type: 'video/mp4', ...(tag ? { tag } : {}) },
      { 'X-Test': '1' },
    ).then((sent) => {
      if (!sent) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return (headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }>(
      (resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/', method, headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers });
          });
        });
        req.on('error', reject);
        req.end();
      },
    );
}

describe('a file sent in pieces (Session 54, D1)', () => {
  it('sends the whole file, or the piece a Range asks for, from the disk', async () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const file = join(dir, 'clip.mp4');
    writeFileSync(file, bytes);
    const get = await serve(file);
    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.body.equals(bytes)).toBe(true);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-type']).toBe('video/mp4');
    expect(whole.headers['content-length']).toBe('1000');
    expect(whole.headers['x-test']).toBe('1');
    // As a <video> asks, a piece at a time: the start, a middle, the end, and from a place to the end.
    const start = await get({ Range: 'bytes=0-1' });
    expect(start.status).toBe(206);
    expect(start.headers['content-range']).toBe('bytes 0-1/1000');
    expect([...start.body]).toEqual([0, 1]);
    const middle = await get({ Range: 'bytes=300-309' });
    expect(middle.body.equals(bytes.subarray(300, 310))).toBe(true);
    expect(middle.headers['content-length']).toBe('10');
    const last = await get({ Range: 'bytes=-5' });
    expect(last.headers['content-range']).toBe('bytes 995-999/1000');
    const rest = await get({ Range: 'bytes=990-' });
    expect(rest.body.equals(bytes.subarray(990))).toBe(true);
    // Past the end: 416, saying how big it is.
    const past = await get({ Range: 'bytes=5000-' });
    expect(past.status).toBe(416);
    expect(past.headers['content-range']).toBe('bytes */1000');
    // Several ranges at once: the whole file, as HTTP allows.
    expect((await get({ Range: 'bytes=0-1,5-6' })).status).toBe(200);
  });

  it('answers an unchanged file without sending it again, and a Range for an older one with the whole', async () => {
    const file = join(dir, 'picture.jpg');
    writeFileSync(file, Buffer.alloc(500, 3));
    const get = await serve(file, 'pic-640-v1.jpg');
    const first = await get();
    expect(first.headers['etag']).toBe('"pic-640-v1.jpg"');
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const again = await get({ 'If-None-Match': '"pic-640-v1.jpg"' });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect((await get({ 'If-None-Match': '"pic-640-v0.jpg"' })).status).toBe(200);
    expect((await get({ Range: 'bytes=0-9', 'If-Range': '"pic-640-v0.jpg"' })).status).toBe(200);
    expect((await get({ Range: 'bytes=0-9', 'If-Range': '"pic-640-v1.jpg"' })).status).toBe(206);
  });

  it('sends nothing for a file that is not there', async () => {
    const get = await serve(join(dir, 'gone.mp4'));
    expect((await get()).status).toBe(404);
  });
});

describe('a link to a file’s original, for a <video> (Session 54, D1)', () => {
  const key = Buffer.alloc(32, 9);

  it('works for the device and the file it was made for, until it runs out', () => {
    let now = 1_000_000;
    const links = new MediaLinks(key, () => now);
    const { ticket, until } = links.make('device-1', 'media-1');
    expect(until).toBe(1_000_000 + MEDIA_LINK_MS);
    expect(links.check(ticket, 'media-1')).toBe('device-1');
    // Another file, another key (Drashti started again), out of date.
    expect(links.check(ticket, 'media-2')).toBeNull();
    expect(new MediaLinks(Buffer.alloc(32, 8), () => now).check(ticket, 'media-1')).toBeNull();
    now = until + 1;
    expect(links.check(ticket, 'media-1')).toBeNull();
  });

  it('refuses a link changed or made up', () => {
    const links = new MediaLinks(key, () => 1_000_000);
    const { ticket } = links.make('device-1', 'media-1');
    const [, at = '', signature = ''] = ticket.split('.');
    // Another device's name on it, a later time, a signature cut short, or something else entirely.
    expect(links.check(`device-2.${at}.${signature}`, 'media-1')).toBeNull();
    expect(
      links.check(`device-1.${(parseInt(at, 36) + 1000).toString(36)}.${signature}`, 'media-1'),
    ).toBeNull();
    expect(links.check(`device-1.${at}.${signature.slice(1)}`, 'media-1')).toBeNull();
    for (const bad of ['', 'a.b', 'device-1..x', `../x.${at}.${signature}`, `${ticket}.more`])
      expect(links.check(bad, 'media-1'), bad).toBeNull();
  });
});
