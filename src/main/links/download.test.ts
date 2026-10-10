import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchToFile, lookAt, type FetchOptions } from './download';
import { nodeGet } from './http';

/* A local server stands in for Dropbox (PLAN §6): made-up links, placeholder bytes. */

let server: Server | null = null;
let requests: { range: string | undefined }[] = [];

async function stand(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  requests = [];
  server = createServer((req, res) => {
    requests.push({ range: req.headers.range });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

afterEach(async () => {
  const s = server;
  server = null;
  if (s) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});

const FILE_LINK = 'https://www.dropbox.com/scl/fi/abc123placeholder/clip.mp4?rlkey=placeholderkey&dl=1';
const FOLDER_LINK = 'https://www.dropbox.com/scl/fo/abc123placeholder/def456?rlkey=placeholderkey&dl=1';
const BYTES = Buffer.from('placeholder video bytes '.repeat(20_000));

/** Serves BYTES as clip.mp4, by range when asked. */
function fileServer(options: { ranges?: boolean; slowAfter?: number } = {}) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const range = /^bytes=(\d+)-$/u.exec(req.headers.range ?? '');
    const headers = { 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="clip.mp4"' };
    if (range && options.ranges !== false) {
      const from = Number(range[1]);
      res.writeHead(206, {
        ...headers,
        'Content-Length': String(BYTES.length - from),
        'Content-Range': `bytes ${String(from)}-${String(BYTES.length - 1)}/${String(BYTES.length)}`,
      });
      res.end(BYTES.subarray(from));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(BYTES.length) });
    res.end(BYTES);
  };
}

function options(origin: string, part: string, over: Partial<FetchOptions> = {}): FetchOptions {
  return {
    testOrigin: origin,
    guard: true,
    signal: new AbortController().signal,
    part,
    held: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    keepFree: 2 * 1024 ** 3,
    maxBytes: 100 * 1024 ** 3,
    progress: () => undefined,
    ...over,
  };
}

describe('looking at a link before downloading', () => {
  it('reads the file’s name and size from what Dropbox sends', async () => {
    const origin = await stand(fileServer());
    const look = await lookAt(FILE_LINK, nodeGet, {
      testOrigin: origin,
      guard: true,
      signal: new AbortController().signal,
    });
    expect(look).toEqual({ name: 'clip.mp4', size: BYTES.length, zip: false });
  });

  it('sees a folder’s zip (no size yet)', async () => {
    const origin = await stand((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="Placeholder folder.zip"',
      });
      res.write('PK');
      setTimeout(() => res.end(), 50);
    });
    const look = await lookAt(FOLDER_LINK, nodeGet, {
      testOrigin: origin,
      guard: true,
      signal: new AbortController().signal,
    });
    expect(look).toEqual({ name: 'Placeholder folder.zip', size: null, zip: true });
  });

  it('refuses a web page in place of the file', async () => {
    const origin = await stand((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html>placeholder</html>');
    });
    await expect(
      lookAt(FILE_LINK, nodeGet, { testOrigin: origin, guard: true, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'page' });
  });
});

describe('downloading to a part-file', () => {
  it('writes every byte, with progress', async () => {
    const origin = await stand(fileServer());
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    const part = join(dir, '.drashti-x.part');
    const seen: number[] = [];
    const got = await fetchToFile(
      FILE_LINK,
      nodeGet,
      options(origin, part, { progress: (d) => seen.push(d) }),
    );
    expect(got).toEqual({ name: 'clip.mp4', bytes: BYTES.length, zip: false });
    expect(readFileSync(part).equals(BYTES)).toBe(true);
    expect(seen.at(-1)).toBe(BYTES.length);
  });

  it('stops while held (the stream on air) and carries on from where it was, by range', async () => {
    const origin = await stand(fileServer());
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    const part = join(dir, '.drashti-x.part');
    // Some bytes are here from before the hold.
    writeFileSync(part, BYTES.subarray(0, 1000));
    let held = true;
    setTimeout(() => (held = false), 300);
    const got = await fetchToFile(
      FILE_LINK,
      nodeGet,
      options(origin, part, { held: () => held, holdPollMs: 20 }),
    );
    expect(got.bytes).toBe(BYTES.length);
    expect(readFileSync(part).equals(BYTES)).toBe(true);
    // Nothing was asked while held; then only the rest.
    expect(requests).toEqual([{ range: 'bytes=1000-' }]);
  });

  it('starts again from the beginning when the server will not send a range', async () => {
    const origin = await stand(fileServer({ ranges: false }));
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    const part = join(dir, '.drashti-x.part');
    writeFileSync(part, 'stale bytes that must go');
    await fetchToFile(FILE_LINK, nodeGet, options(origin, part));
    expect(readFileSync(part).equals(BYTES)).toBe(true);
  });

  it('stops when told, and when the disk would be left with less than the space kept free', async () => {
    const origin = await stand(fileServer());
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    const stop = new AbortController();
    stop.abort();
    await expect(
      fetchToFile(FILE_LINK, nodeGet, options(origin, join(dir, 'a.part'), { signal: stop.signal })),
    ).rejects.toMatchObject({ code: 'stopped' });
    await expect(
      fetchToFile(FILE_LINK, nodeGet, options(origin, join(dir, 'b.part'), { freeBytes: () => 1024 ** 3 })),
    ).rejects.toMatchObject({ code: 'space' });
  });

  it('refuses more than the most it may take', async () => {
    const origin = await stand(fileServer());
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    await expect(
      fetchToFile(FILE_LINK, nodeGet, options(origin, join(dir, 'c.part'), { maxBytes: 1000 })),
    ).rejects.toMatchObject({ code: 'space' });
  });

  it('says so when the download ends short', async () => {
    const origin = await stand((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(BYTES.length) });
      res.write(BYTES.subarray(0, 5000));
      setTimeout(() => res.destroy(), 30);
    });
    const dir = mkdtempSync(join(tmpdir(), 'drashti-dl-'));
    const error = await fetchToFile(FILE_LINK, nodeGet, options(origin, join(dir, 'd.part'))).catch(
      (e: unknown) => e,
    );
    expect((error as { code?: string }).code).toMatch(/short|network/u);
    expect(existsSync(join(dir, 'clip.mp4'))).toBe(false);
  });
});
