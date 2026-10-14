import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mediaUrl,
  playbackCorrection,
  playbackOffset,
  playbackPosition,
  sharpenedUrl,
  SOUND_LIMITS,
  stillUrl,
} from '../../shared/media';
import type { MediaFileRow, MediaProtocolDeps } from './media-protocol';
import { handleMediaRequest, isInside, mediaRequestOf, parseRange, stillPath } from './media-protocol';

let root: string;
let deps: MediaProtocolDeps & { warnings: string[] };
/** File symlinks need extra rights on Windows; junctions (folder links) do not. */
let fileLinks = true;
const BYTES = Uint8Array.from({ length: 100 }, (_, i) => i);
const SHA = 'ab'.repeat(32);
const STILL = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const COPY = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

beforeAll(() => {
  // Not through realpath: on macOS the temp folder is behind a link (/var -> /private/var), as on some machines the media folder may be.
  root = mkdtempSync(join(tmpdir(), 'drashti-media-'));
  const mediaDir = join(root, 'Media');
  const outside = join(root, 'outside');
  for (const dir of [join(mediaDir, 'ab'), join(mediaDir, 'cd'), join(mediaDir, 'ef', 'folder.mp4'), outside])
    mkdirSync(dir, { recursive: true });
  writeFileSync(join(mediaDir, 'ab', 'image.png'), BYTES);
  mkdirSync(join(mediaDir, 'stills'));
  writeFileSync(join(mediaDir, stillPath(SHA)), STILL);
  mkdirSync(join(mediaDir, 'sharpened'));
  writeFileSync(join(mediaDir, 'sharpened', `${SHA}-50.png`), COPY);
  writeFileSync(join(mediaDir, 'cd', 'empty.mp4'), new Uint8Array());
  writeFileSync(join(outside, 'secret.txt'), 'not media');
  symlinkSync(outside, join(mediaDir, 'gh'), 'junction');
  try {
    symlinkSync(join(outside, 'secret.txt'), join(mediaDir, 'ab', 'link.png'));
  } catch {
    fileLinks = false;
  }
  const row = (path: string, missing = false, sha256: string | null = null): MediaFileRow => ({
    path,
    missing,
    sha256,
  });
  const rows: Record<string, MediaFileRow> = {
    image: row('ab/image.png', false, SHA),
    empty: row('cd/empty.mp4'),
    folder: row('ef/folder.mp4'),
    missing: row('', true),
    stale: row('ab/image.png', true, SHA),
    absolute: row(join(outside, 'secret.txt')),
    climb: row('../outside/secret.txt'),
    junction: row('gh/secret.txt'),
    link: row('ab/link.png'),
    gone: row('ij/deleted.png'),
    noStill: row('ab/image.png', false, 'cd'.repeat(32)),
    badSha: row('ab/image.png', false, '../../outside/secret'),
  };
  const warnings: string[] = [];
  deps = {
    mediaDir,
    lookup: (id) => rows[id] ?? null,
    // The copies that are ready (Session 26f): at 50 % for the picture with SHA only.
    sharpened: (sha256, step) => (sha256 === SHA && step === 50 ? `sharpened/${SHA}-50.png` : null),
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
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await bytesOf(res)).toEqual(BYTES);
  });

  it("serves an item's still frame once one has been made, and nothing else as a still", async () => {
    const res = await get(stillUrl('image', 3));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await bytesOf(res)).toEqual(STILL);
    for (const id of ['noStill', 'badSha', 'empty', 'missing', 'stale', 'nobody']) {
      expect((await get(stillUrl(id))).status, id).toBe(404);
    }
  });

  it("serves a picture's sharpened copy once it is ready, at its step only, and only the library's", async () => {
    const res = await get(sharpenedUrl('image', 50, 2));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(await bytesOf(res)).toEqual(COPY);
    // Another step (being made), no copy yet, a missing picture, an id that is not the library's: none.
    for (const url of [
      sharpenedUrl('image', 55),
      sharpenedUrl('noStill', 50),
      sharpenedUrl('stale', 50),
      sharpenedUrl('nobody', 50),
      'drashti-media://sharp/image',
      'drashti-media://sharp/image/abc',
      'drashti-media://sharp/image/50/x',
    ])
      expect((await get(url)).status, url).toBe(404);
    // Without the library's copies (a page that has none), none at all.
    const { sharpened: _sharpened, ...none } = deps;
    expect((await handleMediaRequest(new Request(sharpenedUrl('image', 50)), none)).status).toBe(404);
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
    const id = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
    expect(mediaRequestOf(mediaUrl(id))).toEqual({ what: 'media', mediaId: id });
    expect(mediaRequestOf(stillUrl(id, 2))).toEqual({ what: 'still', mediaId: id });
    expect(mediaRequestOf('drashti-media://media/abc?v=2')).toEqual({ what: 'media', mediaId: 'abc' });
    // A later try at a file (its own URL, so Chromium asks again) is the same file.
    expect(mediaUrl(id, 2)).toBe(`drashti-media://media/${id}?try=2`);
    expect(mediaRequestOf(mediaUrl(id, 2))).toEqual({ what: 'media', mediaId: id });
    expect(mediaUrl(id, 0)).toBe(mediaUrl(id));
    // A sharpened copy (Session 26f): the picture's id and the step.
    expect(sharpenedUrl(id, 35)).toBe(`drashti-media://sharp/${id}/35`);
    expect(mediaRequestOf(sharpenedUrl(id, 35, 3))).toEqual({ what: 'sharp', mediaId: id, step: 35 });
    for (const step of ['0', '7', '105', '-5', '5.5', ''])
      expect(mediaRequestOf(`drashti-media://sharp/${id}/${step}`), step).toBeNull();
    expect(mediaRequestOf('drashti-media://media/a.b')).toBeNull();
    expect(mediaRequestOf('drashti-media://media/a%20b')).toBeNull();
    expect(mediaRequestOf('drashti-media://thumbs/abc')).toBeNull();
    expect(mediaRequestOf('https://media/abc')).toBeNull();
    expect(mediaRequestOf('not a url')).toBeNull();
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

describe('playback position', () => {
  it('follows the clock from the start time, wrapping when looping and stopping at the end otherwise', () => {
    expect(playbackPosition({ startedAt: 1000, loop: true }, 4, 1000)).toBe(0);
    expect(playbackPosition({ startedAt: 1000, loop: true }, 4, 3500)).toBe(2.5);
    expect(playbackPosition({ startedAt: 1000, loop: true }, 4, 11_500)).toBe(2.5);
    expect(playbackPosition({ startedAt: 1000, loop: false }, 4, 11_500)).toBe(4);
    // A clock slightly behind the start time, and files without a known length, start from the top.
    expect(playbackPosition({ startedAt: 1000, loop: true }, 4, 990)).toBe(0);
    expect(playbackPosition({ startedAt: 1000, loop: true }, Infinity, 5000)).toBe(0);
    expect(playbackPosition({ startedAt: 1000, loop: true }, NaN, 5000)).toBe(0);
  });
});

describe('keeping playback in step', () => {
  it('measures how far a file is from the clock, the short way round a loop', () => {
    expect(playbackOffset(2.1, 2, 4, true)).toBeCloseTo(0.1);
    expect(playbackOffset(1.9, 2, 4, true)).toBeCloseTo(-0.1);
    expect(playbackOffset(3.9, 0.1, 4, true)).toBeCloseTo(-0.2);
    expect(playbackOffset(0.1, 3.9, 4, true)).toBeCloseTo(0.2);
    expect(playbackOffset(0.1, 3.9, 4, false)).toBeCloseTo(-3.8);
    expect(playbackOffset(1, 2, Infinity, true)).toBe(-1);
  });

  it('jumps when far out, nudges the speed when a little out, and leaves it alone in step', () => {
    expect(playbackCorrection(0.3)).toEqual({ seek: true });
    expect(playbackCorrection(-0.6)).toEqual({ seek: true });
    expect(playbackCorrection(0.005)).toEqual({ seek: false, rate: 1 });
    expect(playbackCorrection(0.02)).toEqual({ seek: false, rate: 0.96 });
    expect(playbackCorrection(-0.02)).toEqual({ seek: false, rate: 1.04 });
    expect(playbackCorrection(0.2)).toEqual({ seek: false, rate: 0.95 });
    // Sound: jumps later, and changes speed less.
    expect(playbackCorrection(-0.3, SOUND_LIMITS)).toEqual({ seek: false, rate: 1.02 });
    expect(playbackCorrection(-0.6, SOUND_LIMITS)).toEqual({ seek: true });
  });
});
