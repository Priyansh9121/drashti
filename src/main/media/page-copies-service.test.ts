import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConvertService, CopyOptions } from '../convert/convert-service';
import type { MediaInfo } from '../convert/plan';
import { PAGE_COPIES_DIR, PageCopies, pageCopyName, type PageCopiesDeps } from './page-copies';

/*
 * Making the page copies (QA23-FADE-9 candidate 1): only on a slow computer, only while idle, one at a time, of the
 * crossfading playlists' videos that are taller than a page draws them; told to the pages once made. Generated files.
 */

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tall: MediaInfo = {
  container: 'matroska,webm',
  durationMs: 8000,
  video: { codec: 'vp8', pixFmt: 'yuv420p', width: 1920, height: 1080, still: false },
  audio: { codec: 'opus' },
};

function setup(more: Partial<PageCopiesDeps> = {}, infos: Record<string, MediaInfo> = {}) {
  const mediaDir = mkdtempSync(join(tmpdir(), 'drashti-page-copies-service-'));
  dirs.push(mediaDir);
  const made: { source: string; dest: string; copy: CopyOptions }[] = [];
  const saveCopy = vi.fn<ConvertService['saveCopy']>((source, dest, _info, copy) => {
    made.push({ source, dest, copy });
    writeFileSync(dest, 'placeholder copy');
    return { id: String(made.length), done: Promise.resolve({ ok: true as const, copy: dest }) };
  });
  const changed = vi.fn();
  const deps: PageCopiesDeps = {
    mediaDir,
    slow: () => true,
    idle: () => true,
    candidates: () => [{ mediaId: 'red', sha256: SHA_A, path: 'red.webm' }],
    liveShas: () => new Set([SHA_A, SHA_B]),
    info: (file) => Promise.resolve(infos[file] ?? tall),
    conversions: { saveCopy },
    changed,
    log: vi.fn(),
    ...more,
  };
  return { copies: new PageCopies(deps), mediaDir, made, saveCopy, changed };
}

it('makes a 720p and then a 540p copy of a crossfading video, one a step, while idle, and tells the pages', async () => {
  const { copies, mediaDir, made, changed } = setup();
  await copies.start();
  await copies.step();
  expect(made.map((m) => m.dest)).toEqual([
    join(mediaDir, PAGE_COPIES_DIR, pageCopyName(SHA_A, 720, 'webm')),
  ]);
  expect(made[0]?.source).toBe(join(mediaDir, 'red.webm'));
  expect(made[0]?.copy).toMatchObject({ waitForShow: true, background: true, lengthMs: 8000 });
  expect(made[0]?.copy.args('tmp-file')).toContain('-copyts');
  expect(copies.ready()).toEqual({ red: [720] });
  expect(changed).toHaveBeenCalledTimes(1);
  await copies.step();
  expect(copies.ready()).toEqual({ red: [540, 720] });
  expect(copies.relativePath(SHA_A, 540)).toBe(join(PAGE_COPIES_DIR, pageCopyName(SHA_A, 540, 'webm')));
  await copies.step();
  expect(made, 'nothing more to make').toHaveLength(2);
  copies.close();
});

it('makes nothing on a computer that is not slow, or while something is up, and nothing for a video no taller', async () => {
  const fast = setup({ slow: () => false });
  await fast.copies.start();
  await fast.copies.step();
  expect(fast.made).toEqual([]);
  const busy = setup({ idle: () => false });
  await busy.copies.start();
  await busy.copies.step();
  expect(busy.made).toEqual([]);
  const small = setup({}, {});
  const smallInfo = { ...tall, video: { ...tall.video!, width: 1280, height: 720 } };
  const s = setup({ info: () => Promise.resolve(smallInfo) });
  await s.copies.start();
  await s.copies.step();
  await s.copies.step();
  expect(
    s.made.map((m) => m.dest),
    'a 720p video: only its 540p copy',
  ).toEqual([join(s.mediaDir, PAGE_COPIES_DIR, pageCopyName(SHA_A, 540, 'webm'))]);
  for (const x of [fast, busy, small, s]) x.copies.close();
});

it('finds the copies already there at its start, and sweeps those whose source is gone first', async () => {
  const { copies, mediaDir, made } = setup({ liveShas: () => new Set([SHA_A]) });
  mkdirSync(join(mediaDir, PAGE_COPIES_DIR), { recursive: true });
  for (const n of [
    pageCopyName(SHA_A, 720, 'webm'),
    pageCopyName(SHA_A, 540, 'webm'),
    pageCopyName(SHA_B, 720, 'webm'),
  ])
    writeFileSync(join(mediaDir, PAGE_COPIES_DIR, n), 'placeholder copy');
  await copies.start();
  expect(readdirSync(join(mediaDir, PAGE_COPIES_DIR)).sort()).toEqual(
    [pageCopyName(SHA_A, 540, 'webm'), pageCopyName(SHA_A, 720, 'webm')].sort(),
  );
  expect(copies.ready()).toEqual({ red: [540, 720] });
  await copies.step();
  expect(made, 'both there already').toEqual([]);
  copies.close();
});

it('a copy that fails is not tried again and again, and tells no one; nothing is said with nothing to make', async () => {
  const failing = vi.fn<ConvertService['saveCopy']>(() => ({
    id: 'x',
    done: Promise.resolve({ ok: false as const, message: 'placeholder failure' }),
  }));
  const { copies, mediaDir, changed } = setup({ conversions: { saveCopy: failing } });
  await copies.start();
  await copies.step();
  await copies.step();
  expect(failing).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  expect(existsSync(join(mediaDir, PAGE_COPIES_DIR, pageCopyName(SHA_A, 720, 'webm')))).toBe(false);
  expect(copies.ready()).toEqual({});
  copies.close();
  const none = setup({ candidates: () => [] });
  await none.copies.start();
  await none.copies.step();
  expect(none.made).toEqual([]);
  expect(none.copies.ready()).toEqual({});
  none.copies.close();
});
