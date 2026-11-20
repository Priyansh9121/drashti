import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
