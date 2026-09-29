import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaUrl } from '../../shared/media';
import type { MediaFileRow, MediaProtocolDeps } from './media-protocol';
import { handleMediaRequest, isInside, mediaIdOf, parseRange } from './media-protocol';

let root: string;
let deps: MediaProtocolDeps & { warnings: string[] };
/** File symlinks need extra rights on Windows; junctions (folder links) do not. */
let fileLinks = true;
const BYTES = Uint8Array.from({ length: 100 }, (_, i) => i);

beforeAll(() => {
  // Not through realpath: on macOS the temp folder is behind a link (/var -> /private/var), as on some machines the media folder may be.
  root = mkdtempSync(join(tmpdir(), 'drashti-media-'));
  const mediaDir = join(root, 'Media');
  const outside = join(root, 'outside');
  for (const dir of [join(mediaDir, 'ab'), join(mediaDir, 'cd'), join(mediaDir, 'ef', 'folder.mp4'), outside])
    mkdirSync(dir, { recursive: true });
  writeFileSync(join(mediaDir, 'ab', 'image.png'), BYTES);
  writeFileSync(join(mediaDir, 'cd', 'empty.mp4'), new Uint8Array());
  writeFileSync(join(outside, 'secret.txt'), 'not media');
  symlinkSync(outside, join(mediaDir, 'gh'), 'junction');
  try {
    symlinkSync(join(outside, 'secret.txt'), join(mediaDir, 'ab', 'link.png'));
  } catch {
    fileLinks = false;
  }
  const rows: Record<string, MediaFileRow> = {
    image: { path: 'ab/image.png', missing: false },
    empty: { path: 'cd/empty.mp4', missing: false },
    folder: { path: 'ef/folder.mp4', missing: false },
    missing: { path: '', missing: true },
    stale: { path: 'ab/image.png', missing: true },
    absolute: { path: join(outside, 'secret.txt'), missing: false },
    climb: { path: '../outside/secret.txt', missing: false },
    junction: { path: 'gh/secret.txt', missing: false },
    link: { path: 'ab/link.png', missing: false },
    gone: { path: 'ij/deleted.png', missing: false },
  };
  const warnings: string[] = [];
  deps = {
    mediaDir,
    lookup: (id) => rows[id] ?? null,
    warn: (m) => warnings.push(m),
    warnings,
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const get = (url: string, init?: RequestInit) => handleMediaRequest(new Request(url, init), deps);
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe('drashti-media:// requests', () => {
  it('serves a media file by id, with its type and length', async () => {
    const res = await get(mediaUrl('image'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await bytesOf(res)).toEqual(BYTES);
  });

  it('serves byte ranges, which video seeking needs', async () => {
    const slice = await get(mediaUrl('image'), { headers: { Range: 'bytes=10-19' } });
    expect(slice.status).toBe(206);
    expect(slice.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(slice.headers.get('Content-Length')).toBe('10');
    expect(await bytesOf(slice)).toEqual(BYTES.slice(10, 20));

    const toEnd = await get(mediaUrl('image'), { headers: { Range: 'bytes=95-' } });
    expect(toEnd.status).toBe(206);
    expect(await bytesOf(toEnd)).toEqual(BYTES.slice(95));

    const suffix = await get(mediaUrl('image'), { headers: { Range: 'bytes=-3' } });
    expect(suffix.headers.get('Content-Range')).toBe('bytes 97-99/100');
    expect(await bytesOf(suffix)).toEqual(BYTES.slice(97));

    const pastEnd = await get(mediaUrl('image'), { headers: { Range: 'bytes=90-1000' } });
    expect(pastEnd.headers.get('Content-Range')).toBe('bytes 90-99/100');
  });

  it('answers 416 for a range past the end, and the whole file for a range it does not serve', async () => {
    const past = await get(mediaUrl('image'), { headers: { Range: 'bytes=100-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('Content-Range')).toBe('bytes */100');
    for (const range of ['bytes=0-1,5-6', 'bytes=9-2', 'items=0-1', 'bytes=abc']) {
      const whole = await get(mediaUrl('image'), { headers: { Range: range } });
      expect(whole.status, range).toBe(200);
      expect((await bytesOf(whole)).length, range).toBe(100);
    }
  });

  it('answers HEAD without a body, serves empty files, and refuses other methods', async () => {
    const head = await get(mediaUrl('image'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('100');
    expect(head.body).toBeNull();

    const empty = await get(mediaUrl('empty'));
    expect(empty.status).toBe(200);
    expect(empty.headers.get('Content-Length')).toBe('0');
    expect((await get(mediaUrl('empty'), { headers: { Range: 'bytes=0-' } })).status).toBe(416);

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await get(mediaUrl('image'), { method, body: method === 'DELETE' ? null : 'x' });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    }
  });

  it('answers 404 for ids it does not know and URLs it does not make', async () => {
    for (const url of [
      mediaUrl('nobody'),
      mediaUrl(''),
      'drashti-media://media/image/extra',
      'drashti-media://media/..%2F..%2Foutside%2Fsecret.txt',
      'drashti-media://media/%2e%2e',
      'drashti-media://other/image',
      'drashti-media://media',
      'file:///etc/hosts',
    ]) {
      const res = await get(url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('answers 404 for missing media, folders and files that are gone', async () => {
    for (const id of ['missing', 'stale', 'folder', 'gone']) {
      expect((await get(mediaUrl(id))).status, id).toBe(404);
    }
  });

  it('never serves a file outside the media folder, whatever the library says', async () => {
    deps.warnings.length = 0;
    for (const id of ['absolute', 'climb', 'junction', ...(fileLinks ? ['link'] : [])]) {
      const res = await get(mediaUrl(id));
      expect(res.status, id).toBe(404);
      expect(await res.text(), id).toBe('');
    }
    expect(deps.warnings).toHaveLength(fileLinks ? 4 : 3);
  });
});

describe('media URLs and ranges', () => {
  it('reads the id from URLs Drashti makes, and nothing else', () => {
    expect(mediaIdOf(mediaUrl('0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'))).toBe(
      '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
    );
    expect(mediaIdOf('drashti-media://media/abc?v=2')).toBe('abc');
    expect(mediaIdOf('drashti-media://media/a.b')).toBeNull();
    expect(mediaIdOf('drashti-media://media/a%20b')).toBeNull();
    expect(mediaIdOf('https://media/abc')).toBeNull();
    expect(mediaIdOf('not a url')).toBeNull();
  });

  it('knows what is inside a folder', () => {
    const dir = join(root, 'Media');
    expect(isInside(dir, join(dir, 'ab', 'x.png'))).toBe(true);
    expect(isInside(dir, dir)).toBe(false);
    expect(isInside(dir, `${dir}-other`)).toBe(false);
    expect(isInside(dir, join(dir, '..', 'outside'))).toBe(false);
    expect(isInside(dir, join(root, 'outside', 'secret.txt'))).toBe(false);
  });

  it('parses single byte ranges', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-', 10)).toBeNull();
    expect(parseRange(' bytes=2-3 ', 10)).toEqual({ start: 2, end: 3 });
  });
});
