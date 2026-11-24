import { mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { handleDisplaySourceRequest } from './display-worker-source';

const SHA = 'a'.repeat(64);
const KEY = 'p1-' + SHA.slice(0, 32) + '-1920x1080';
const URL = 'drashti-media://media/' + KEY;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-display-source-'));
  dirs.push(dir);
  const mediaDir = join(dir, 'Media');
  mkdirSync(join(mediaDir, 'aa'), { recursive: true });
  const path = `aa/${SHA}.png`;
  const bytes = Buffer.from('Generated source bytes only');
  writeFileSync(join(mediaDir, path), bytes);
  const state = { current: true, path };
  const lookup = vi.fn((key: string) =>
    state.current && key === KEY ? { path: state.path, sha256: SHA, missing: false } : null,
  );
  const ask = (url = URL, init?: RequestInit) =>
    handleDisplaySourceRequest(new Request(url, init), { mediaDir, lookup });
  return { dir, mediaDir, path, bytes, state, lookup, ask };
}

it('streams the current owned original byte for byte, with its existing MIME and ranges', async () => {
  const t = setup();
  const whole = await t.ask();
  expect(whole.status).toBe(200);
  expect(whole.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await whole.arrayBuffer())).toEqual(t.bytes);
  const part = await t.ask(URL, { headers: { Range: 'bytes=2-6' } });
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe(`bytes 2-6/${String(t.bytes.length)}`);
  expect(Buffer.from(await part.arrayBuffer())).toEqual(t.bytes.subarray(2, 7));
  const head = await t.ask(URL, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.body).toBeNull();
  expect(head.headers.get('content-length')).toBe(String(t.bytes.length));
});

it.each(['still', 'opening'])('never exposes the %s role even when its file exists', async (role) => {
  const t = setup();
  mkdirSync(join(t.mediaDir, role === 'still' ? 'stills' : 'opening'));
  writeFileSync(join(t.mediaDir, role === 'still' ? 'stills' : 'opening', SHA + '.jpg'), 'Other role');
  const result = await t.ask(`drashti-media://${role}/${KEY}`);
  await result.arrayBuffer();
  expect(result.status).toBe(404);
  expect(t.lookup).not.toHaveBeenCalled();
});

it.each(['HEAD', 'GET'])(
  'refuses an over-cap source by total size, including a one-byte range (%s)',
  async (method) => {
    const t = setup();
    truncateSync(join(t.mediaDir, t.path), 256 * 1024 * 1024 + 1);
    const result = await t.ask(URL, { method, headers: { Range: 'bytes=0-0' } });
    await result.arrayBuffer();
    expect(result.status).toBe(404);
  },
);

it('withdraws a completed job key and refuses a different key', async () => {
  const t = setup();
  t.state.current = false;
  expect((await t.ask()).status).toBe(404);
  expect((await t.ask('drashti-media://media/another-job')).status).toBe(404);
});

it('refuses a source outside Media and a source deleted after its grant', async () => {
  const t = setup();
  writeFileSync(join(t.dir, 'outside.png'), 'Generated outside source');
  t.state.path = '../outside.png';
  expect((await t.ask()).status).toBe(404);
  t.state.path = t.path;
  rmSync(join(t.mediaDir, t.path));
  expect((await t.ask()).status).toBe(404);
});

it('does not allow a write method', async () => {
  const t = setup();
  const result = await t.ask(URL, { method: 'POST', body: 'No writes' });
  expect(result.status).toBe(405);
  expect(result.headers.get('allow')).toBe('GET, HEAD');
});

it('does not cache a job address beyond its ownership', async () => {
  const t = setup();
  const result = await t.ask(URL, { method: 'HEAD' });
  expect(result.headers.get('cache-control')).toBe('no-store');
});

it('returns the native file response itself without reading or locking its body', async () => {
  const t = setup();
  const reply = new Response(t.bytes, {
    headers: { 'Content-Length': String(t.bytes.length), 'Cache-Control': 'max-age=3600' },
  });
  const body = reply.body;
  const fetchFile = vi.fn(() => Promise.resolve(reply));
  const result = await handleDisplaySourceRequest(new Request(URL), { ...t, fetchFile });
  const sameResponse = result === reply;
  const sameBody = result.body === body;
  expect(result.bodyUsed).toBe(false);
  expect(result.body?.locked).toBe(false);
  expect(Buffer.from(await result.arrayBuffer())).toEqual(t.bytes);
  expect(sameResponse).toBe(true);
  expect(sameBody).toBe(true);
  expect(fetchFile).toHaveBeenCalledExactlyOnceWith(
    pathToFileURL(realpathSync.native(join(t.mediaDir, t.path))).href,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    },
  );
  expect(result.headers.get('content-type')).toBe('image/png');
  expect(result.headers.get('content-length')).toBe(String(t.bytes.length));
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.headers.get('accept-ranges')).toBe('bytes');
  expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(result.headers.get('access-control-allow-origin')).toBe('*');
});

it('supplies a missing native length from the checked file without replacing the response', async () => {
  const t = setup();
  const reply = new Response(t.bytes);
  const result = await handleDisplaySourceRequest(new Request(URL), {
    ...t,
    fetchFile: () => Promise.resolve(reply),
  });
  await result.arrayBuffer();
  expect(result).toBe(reply);
  expect(result.headers.get('content-length')).toBe(String(t.bytes.length));
});

it('refuses a native fetch failure instead of pumping the original through Main', async () => {
  const t = setup();
  const fetchFile = vi.fn(() => Promise.reject(new Error('Generated native read failure')));
  const result = await handleDisplaySourceRequest(new Request(URL), { ...t, fetchFile });
  await result.arrayBuffer();
  expect(result.status).toBe(404);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(fetchFile).toHaveBeenCalledOnce();
});

it.each(['completed', 'changed source'])(
  'cancels a native reply when the grant is %s while the fetch resolves',
  async (change) => {
    const t = setup();
    const cancel = vi.fn();
    const reply = new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Length': String(t.bytes.length) },
    });
    const result = await handleDisplaySourceRequest(new Request(URL), {
      ...t,
      fetchFile: () => {
        if (change === 'completed') t.state.current = false;
        else t.state.path = 'aa/another-source.png';
        return Promise.resolve(reply);
      },
    });
    await result.arrayBuffer();
    expect(result.status).toBe(404);
    expect(cancel).toHaveBeenCalledOnce();
  },
);

it.each(['0', '268435457', '28', '1e2', 'unknown'])(
  'cancels a native response with an invalid or changed advertised length (%s)',
  async (length) => {
    const t = setup();
    const cancel = vi.fn();
    const reply = new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Length': length },
    });
    const result = await handleDisplaySourceRequest(new Request(URL), {
      ...t,
      fetchFile: () => Promise.resolve(reply),
    });
    await result.arrayBuffer();
    expect(result.status).toBe(404);
    expect(cancel).toHaveBeenCalledOnce();
  },
);

it.each([404, 206])('cancels an unexpected native status (%s)', async (status) => {
  const t = setup();
  const cancel = vi.fn();
  const reply = new Response(new ReadableStream({ cancel }), {
    status,
    headers: { 'Content-Length': String(t.bytes.length) },
  });
  const result = await handleDisplaySourceRequest(new Request(URL), {
    ...t,
    fetchFile: () => Promise.resolve(reply),
  });
  await result.arrayBuffer();
  expect(result.status).toBe(404);
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(['over cap', 'empty', 'outside', 'absolute', 'directory', 'missing', 'withdrawn', 'foreign role'])(
  'checks the granted regular file before any native fetch (%s)',
  async (invalid) => {
    const t = setup();
    let url = URL;
    if (invalid === 'over cap') truncateSync(join(t.mediaDir, t.path), 256 * 1024 * 1024 + 1);
    else if (invalid === 'empty') truncateSync(join(t.mediaDir, t.path), 0);
    else if (invalid === 'outside') {
      writeFileSync(join(t.dir, 'outside.png'), 'Generated outside source');
      t.state.path = '../outside.png';
    } else if (invalid === 'absolute') t.state.path = join(t.mediaDir, t.path);
    else if (invalid === 'directory') t.state.path = 'aa';
    else if (invalid === 'missing') rmSync(join(t.mediaDir, t.path));
    else if (invalid === 'withdrawn') t.state.current = false;
    else url = 'drashti-media://still/' + KEY;
    const fetchFile = vi.fn(() => Promise.resolve(new Response(t.bytes)));
    const result = await handleDisplaySourceRequest(new Request(url), { ...t, fetchFile });
    await result.arrayBuffer();
    expect(result.status).toBe(404);
    expect(fetchFile).not.toHaveBeenCalled();
  },
);

it('keeps HEAD and range reads on their checked path when native fetch is available', async () => {
  const t = setup();
  const fetchFile = vi.fn(() => Promise.resolve(new Response(t.bytes)));
  const head = await handleDisplaySourceRequest(new Request(URL, { method: 'HEAD' }), {
    ...t,
    fetchFile,
  });
  expect(head.status).toBe(200);
  expect(head.body).toBeNull();
  expect(head.headers.get('content-length')).toBe(String(t.bytes.length));
  const part = await handleDisplaySourceRequest(new Request(URL, { headers: { Range: 'bytes=2-6' } }), {
    ...t,
    fetchFile,
  });
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe(`bytes 2-6/${String(t.bytes.length)}`);
  expect(Buffer.from(await part.arrayBuffer())).toEqual(t.bytes.subarray(2, 7));
  expect(fetchFile).not.toHaveBeenCalled();
});
