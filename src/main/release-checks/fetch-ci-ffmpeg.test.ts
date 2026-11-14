import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PAUSES_MS } from '../../../scripts/download-source.mjs';
import { annotation, CI_FFMPEG, ciFfmpegDir, fetchCiFfmpeg } from '../../../scripts/fetch-ci-ffmpeg.mjs';
import { FFMPEG_VERSION } from '../../../scripts/fetch-ffmpeg.mjs';
import { testFfmpeg } from '../testing/ffmpeg-here';

/*
 * CI's own Linux FFmpeg for the unit tests on its Ubuntu runner (Session 58, CI-1), which skipped
 * deck-import.test.ts for want of one. Pinned and checked like the bundled builds; its download tried three times.
 * One that cannot be had leaves nothing behind, so the tests that need it skip as before (a network blip never fails
 * CI); one that does not match its SHA-256 fails, and is never used. A stand-in fetch with made-up answers, pauses
 * that are noted, never waited, and an unpack that writes a placeholder program.
 */

const ARCHIVE = 'Placeholder build archive';
const BUILD = {
  name: 'placeholder-linux64-gpl.tar.xz',
  url: 'https://example.invalid/placeholder-linux64-gpl.tar.xz',
  sha256: createHash('sha256').update(ARCHIVE).digest('hex'),
  member: 'placeholder-linux64-gpl/bin/ffmpeg',
};
const PROGRAM = 'Placeholder program';
/** What Node's fetch throws when a server does not answer: "fetch failed", with why as its cause. */
const NO_ANSWER = () =>
  new TypeError('fetch failed', { cause: new Error('Connect Timeout Error (placeholder)') });

let dir = '';
let cacheDir = '';
let outDir = '';
let events: string[] = [];
let log: MockInstance<typeof console.log>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-ci-ffmpeg-'));
  cacheDir = join(dir, 'cache');
  outDir = ciFfmpegDir(join(dir, 'checkout'));
  events = [];
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in fetch giving each answer in turn: a response, or an error it throws. */
function fetchGiving(...answers: (() => Response | Error)[]) {
  return vi.fn((url: string) => {
    events.push(`fetch ${url}`);
    const answer = answers.shift()?.() ?? new Error('asked once too often');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

/** A pause that is noted when it ends, so a fetch before its end would show. */
async function pause(ms: number) {
  await Promise.resolve();
  events.push(`paused ${String(ms)}`);
}

/** Unpacks the placeholder program from the placeholder archive (and from nothing else). */
function unpack(archive: string, member: string, into: string) {
  events.push(`unpack ${member}`);
  if (readFileSync(archive, 'utf8') !== ARCHIVE) throw new Error('not the placeholder archive');
  const path = join(into, member);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PROGRAM);
  return path;
}

const fetchCi = (fetch: ReturnType<typeof fetchGiving>) =>
  fetchCiFfmpeg({ build: BUILD, cacheDir, outDir, fetch, pause, unpack });
const program = () => join(outDir, 'ffmpeg');

describe('CI’s Linux FFmpeg (scripts/fetch-ci-ffmpeg.mjs)', () => {
  it('is pinned like the bundled builds: a month’s last build of FFmpeg-Builds, of the version Drashti ships', () => {
    const release =
      /^https:\/\/github\.com\/FFmpeg-Builds\/FFmpeg-Builds\/releases\/download\/autobuild-(\d{4})-(\d\d)-(\d\d)-\d\d-\d\d\/([^/]+)$/u.exec(
        CI_FFMPEG.url,
      );
    expect(release?.[4]).toBe(CI_FFMPEG.name);
    // FFmpeg's version as fetch-ffmpeg.mjs pins it for the Mac and Windows builds; GPL and static, as they are.
    expect(CI_FFMPEG.name.startsWith(`ffmpeg-n${FFMPEG_VERSION}-`)).toBe(true);
    expect(CI_FFMPEG.name).toMatch(/-linux64-gpl-\d+\.\d+\.tar\.xz$/u);
    expect(CI_FFMPEG.member).toBe(`${CI_FFMPEG.name.replace(/\.tar\.xz$/u, '')}/bin/ffmpeg`);
    expect(CI_FFMPEG.sha256).toMatch(/^[0-9a-f]{64}$/u);
    // A month's last build, which FFmpeg-Builds keeps for two years (a daily one goes after 14 days).
    const next = new Date(Date.UTC(Number(release?.[1]), Number(release?.[2]) - 1, Number(release?.[3]) + 1));
    expect(next.getUTCDate()).toBe(1);
  });

  it('puts the program where the tests proven on Linux look for it (src/main/testing/ffmpeg-here.ts)', () => {
    const checkout = join(dir, 'checkout');
    expect(testFfmpeg({ linux: true }, checkout, 'linux', 'x64')).toBe(join(ciFfmpegDir(checkout), 'ffmpeg'));
  });

  it('downloads it, checks it and puts the program in its folder, saying where it came from', async () => {
    const fetch = fetchGiving(() => new Response(ARCHIVE));
    expect(await fetchCi(fetch)).toEqual({ ok: true, path: program() });
    expect(events).toEqual([`fetch ${BUILD.url}`, `unpack ${BUILD.member}`]);
    expect(readFileSync(program(), 'utf8')).toBe(PROGRAM);
    const stamp = readFileSync(join(outDir, 'SOURCE.txt'), 'utf8');
    expect(stamp).toContain(`from ${BUILD.url}`);
    expect(stamp).toContain(`sha256 of the download ${BUILD.sha256}`);
    expect(stamp).toContain('never shipped');
    // The download stays for CI's cache, with nothing beside it.
    expect(readdirSync(cacheDir)).toEqual([BUILD.name]);
  });

  it('takes the download CI’s cache kept, without the network', async () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, BUILD.name), ARCHIVE);
    const fetch = fetchGiving();
    expect(await fetchCi(fetch)).toEqual({ ok: true, path: program() });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reuses the program while it is still what was unpacked', async () => {
    await fetchCi(fetchGiving(() => new Response(ARCHIVE)));
    events = [];
    expect(await fetchCi(fetchGiving())).toEqual({ ok: true, path: program() });
    expect(events).toEqual([]);
  });

  it('fails on a download that does not match its SHA-256, which is removed and never used', async () => {
    await expect(fetchCi(fetchGiving(() => new Response('Something else')))).rejects.toThrow(
      `CI's Linux FFmpeg failed its check: sha256 ${createHash('sha256').update('Something else').digest('hex')}, expected ${BUILD.sha256} (${BUILD.url}). It was not used.`,
    );
    expect(events).toEqual([`fetch ${BUILD.url}`]);
    expect(existsSync(program())).toBe(false);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('downloads again a kept download that no longer matches', async () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, BUILD.name), 'A damaged placeholder archive');
    const fetch = fetchGiving(() => new Response(ARCHIVE));
    expect(await fetchCi(fetch)).toEqual({ ok: true, path: program() });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tries again after 5 s and then 15 s, and keeps the download that works', async () => {
    const fetch = fetchGiving(
      NO_ANSWER,
      () => new Response('', { status: 503 }),
      () => new Response(ARCHIVE),
    );
    expect(await fetchCi(fetch)).toEqual({ ok: true, path: program() });
    expect(events).toEqual([
      `fetch ${BUILD.url}`,
      `paused ${String(PAUSES_MS[0])}`,
      `fetch ${BUILD.url}`,
      `paused ${String(PAUSES_MS[1])}`,
      `fetch ${BUILD.url}`,
      `unpack ${BUILD.member}`,
    ]);
  });

  it('after three failed tries says why and leaves nothing behind, so the tests that need it skip as before', async () => {
    const fetch = fetchGiving(NO_ANSWER, NO_ANSWER, NO_ANSWER);
    expect(await fetchCi(fetch)).toEqual({
      ok: false,
      why: `${BUILD.name} could not be downloaded (fetch failed: Connect Timeout Error (placeholder))`,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(existsSync(outDir)).toBe(false);
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});

describe('its annotations in CI', () => {
  it('escape what GitHub’s workflow commands would read as their own', () => {
    expect(annotation('warning', "CI's Linux FFmpeg", 'a: b, 50%\nnext')).toBe(
      "::warning title=CI's Linux FFmpeg::a: b, 50%25%0Anext",
    );
    expect(annotation('error', 'one: two, three', 'x')).toBe('::error title=one%3A two%2C three::x');
  });
});
