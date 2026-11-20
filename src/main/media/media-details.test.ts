import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodecLevel } from '../import/codec-config';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import {
  type DetailsRow,
  MediaDetailsService,
  NOT_READ,
  type Reading,
  readWithFfmpeg,
} from './media-details';

/*
 * Media information… in the main process (alpha.20, Q60-34 item 1): a file read by FFmpeg in its turn, one at a time,
 * kept by its bytes, with the library's own notes; why not, in words, when it could not be read. FFmpeg's reading is
 * a stand-in here (its real text), and then the real bundled FFmpeg on a file made here.
 */

const TEXT = `Input #0, matroska,webm, from '/media/ab/ab12.mkv':
  Duration: 00:00:04.02, start: 0.000000, bitrate: 440 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(tv, progressive), 320x180 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 1k tbn
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp (default)`;

const row = (more: Partial<DetailsRow> = {}): DetailsRow => ({
  name: 'Placeholder clip.mkv',
  kind: 'video',
  path: 'ab/ab12.mkv',
  sha256: 'ab12',
  bytes: 220_416,
  missing: false,
  deleted: false,
  playable: true,
  format: 'H.264 video with AAC sound (Matroska)',
  durationMs: 4020,
  importedAt: '2026-11-20T12:00:00.000Z',
  importedFrom: '/Placeholder folder/Placeholder clip.mkv',
  convertedTo: null,
  copyOf: null,
  playCount: 0,
  lastPlayedAt: null,
  ...more,
});

/** A reading held until the test lets it go. */
function held(): { promise: Promise<Reading>; give: (r: Reading) => void } {
  let give: (r: Reading) => void = () => undefined;
  const promise = new Promise<Reading>((resolve) => {
    give = resolve;
  });
  return { promise, give };
}

function service(
  rows: Record<string, DetailsRow>,
  options: {
    read?: (ffmpeg: string, file: string) => Promise<Reading>;
    level?: (file: string) => Promise<CodecLevel | null>;
    ffmpeg?: string | null;
    converting?: string[];
  } = {},
) {
  const reads: string[] = [];
  const s = new MediaDetailsService({
    mediaDir: '/media',
    row: (id) => rows[id] ?? null,
    ffmpeg: () => (options.ffmpeg === undefined ? '/bundled/ffmpeg' : options.ffmpeg),
    converting: (id) => (options.converting ?? []).includes(id),
    read: (ffmpeg, file) => {
      reads.push(file);
      return options.read ? options.read(ffmpeg, file) : Promise.resolve({ text: TEXT, timedOut: false });
    },
    level: options.level ?? (() => Promise.resolve({ codec: 'h264', profileIdc: 100, level: '3.1' })),
  });
  return { s, reads };
}

describe('Media information in the main process', () => {
  it('reads the library’s file with FFmpeg, its level from its own record, and says the library’s notes', async () => {
    const levels: string[] = [];
    const { s, reads } = service(
      { m1: row() },
      {
        level: (file) => {
          levels.push(file);
          return Promise.resolve({ codec: 'h264', profileIdc: 100, level: '3.1' });
        },
      },
    );
    const result = await s.details('m1');
    expect(reads).toEqual([join('/media', 'ab/ab12.mkv')]);
    expect(levels).toEqual([join('/media', 'ab/ab12.mkv')]);
    expect(result).toMatchObject({
      ok: true,
      details: {
        mediaId: 'm1',
        name: 'Placeholder clip.mkv',
        kind: 'video',
        bytes: 220_416,
        libraryDurationMs: 4020,
        importedAt: '2026-11-20T12:00:00.000Z',
        importedFrom: '/Placeholder folder/Placeholder clip.mkv',
        inDrashti: { state: 'plays' },
        problem: null,
        read: {
          container: 'Matroska',
          durationMs: 4020,
          pictures: [{ codec: 'h264', profile: 'High', level: '3.1', width: 320, height: 180 }],
          sounds: [{ codec: 'aac', language: 'English', channels: 'stereo' }],
        },
      },
    });
  });

  it('a level from another codec’s record is never given to the picture', async () => {
    const { s } = service(
      { m1: row() },
      { level: () => Promise.resolve({ codec: 'hevc', profileIdc: 1, level: '4' }) },
    );
    const result = await s.details('m1');
    expect(result.ok && result.details.read?.pictures[0]?.level).toBeNull();
  });

  it('reads one file at a time, the same file once, and keeps what it read by the file’s bytes', async () => {
    const first = held();
    const second = held();
    const { s, reads } = service(
      {
        a: row(),
        b: row({ path: 'cd/cd34.mkv', sha256: 'cd34' }),
        c: row({ name: 'Placeholder again.mkv' }),
      },
      { read: (_f, file) => (file.includes('ab12') ? first.promise : second.promise) },
    );
    const one = s.details('a');
    const two = s.details('b');
    // The same bytes under another name: one reading for both.
    const again = s.details('c');
    await expect.poll(() => reads.length).toBe(1);
    expect(reads).toEqual([join('/media', 'ab/ab12.mkv')]);
    first.give({ text: TEXT, timedOut: false });
    expect((await one).ok).toBe(true);
    expect(await again).toMatchObject({
      ok: true,
      details: { name: 'Placeholder again.mkv', problem: null },
    });
    // Only now the second file's turn.
    await expect.poll(() => reads.length).toBe(2);
    second.give({ text: TEXT, timedOut: false });
    expect((await two).ok).toBe(true);
    // Asked again: what was read is kept.
    await s.details('a');
    await s.details('b');
    expect(reads).toHaveLength(2);
  });

  it('says why a file was not read, and reads it again next time', async () => {
    let timedOut = true;
    const { s, reads } = service(
      { m1: row() },
      {
        read: () =>
          Promise.resolve(timedOut ? { text: '', timedOut: true } : { text: TEXT, timedOut: false }),
      },
    );
    expect(await s.details('m1')).toMatchObject({
      ok: true,
      details: { read: null, problem: NOT_READ.timedOut },
    });
    timedOut = false;
    expect(await s.details('m1')).toMatchObject({ ok: true, details: { problem: null } });
    expect(reads).toHaveLength(2);

    const damaged = service(
      { m1: row() },
      { read: () => Promise.resolve({ text: 'Invalid data found when processing input', timedOut: false }) },
    );
    expect(await damaged.s.details('m1')).toMatchObject({
      ok: true,
      details: { read: null, problem: NOT_READ.unread },
    });
    const failed = service({ m1: row() }, { read: () => Promise.resolve(null) });
    expect(await failed.s.details('m1')).toMatchObject({ ok: true, details: { problem: NOT_READ.unread } });
    const none = service({ m1: row() }, { ffmpeg: null });
    expect(await none.s.details('m1')).toMatchObject({ ok: true, details: { problem: NOT_READ.noFfmpeg } });
    expect(none.reads).toHaveLength(0);
  });

  it('a missing or deleted file is not read: only the library’s notes, and that it is missing', async () => {
    const { s, reads } = service({
      gone: row({ missing: true, path: '', sha256: null }),
      deleted: row({ deleted: true }),
    });
    for (const id of ['gone', 'deleted'])
      expect(await s.details(id)).toMatchObject({
        ok: true,
        details: { read: null, problem: NOT_READ.missing, inDrashti: { state: 'missing' } },
      });
    expect(reads).toHaveLength(0);
    expect(await s.details('gone')).toMatchObject({ ok: true, details: { bytes: null } });
  });

  it('says how Drashti plays it, from the library', async () => {
    const { s } = service(
      {
        converted: row({ convertedTo: 'Placeholder clip.mp4', playable: false }),
        copy: row({ copyOf: 'Placeholder clip.mov' }),
        waiting: row({ playable: false }),
        cannot: row({ playable: false, format: 'ProRes 422 HQ video (QuickTime)' }),
        maybe: row({ playable: null }),
      },
      { converting: ['waiting'] },
    );
    const state = async (id: string) => {
      const r = await s.details(id);
      return r.ok ? r.details.inDrashti : null;
    };
    expect(await state('converted')).toEqual({ state: 'converted', copy: 'Placeholder clip.mp4' });
    expect(await state('copy')).toEqual({ state: 'copy', of: 'Placeholder clip.mov' });
    expect(await state('waiting')).toEqual({ state: 'converting' });
    expect(await state('cannot')).toEqual({ state: 'cannot', format: 'ProRes 422 HQ video (QuickTime)' });
    expect(await state('maybe')).toEqual({ state: 'maybe' });
  });

  it('is for videos and sounds that are in the library', async () => {
    const { s } = service({ p: row({ kind: 'image' }) });
    expect(await s.details('p')).toEqual({
      ok: false,
      message: 'Media information is for videos and sounds.',
    });
    expect(await s.details('nothing')).toEqual({
      ok: false,
      message: 'That file is no longer in the library.',
    });
  });
});

const ffmpeg = testFfmpeg({ linux: true });

describe.skipIf(!ffmpegHere(ffmpeg))('the bundled FFmpeg reading a file for its information', () => {
  it('prints what the file holds, and is stopped when it takes too long', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-media-details-')), 'Placeholder clip.mp4');
    const made = spawnSync(ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=0.4'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', file],
    ]);
    expect(made.status).toBe(0);
    const reading = await readWithFfmpeg(ffmpeg, file);
    expect(reading?.timedOut).toBe(false);
    expect(reading?.text).toMatch(/^Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/mu);
    expect(reading?.text).toMatch(/Stream #0:0\S*: Video: h264/u);
    expect((await readWithFfmpeg(ffmpeg, file, 1))?.timedOut).toBe(true);
    // No such program: nothing read, and never a throw.
    expect(await readWithFfmpeg(join(tmpdir(), 'no-ffmpeg-here'), file)).toBeNull();
  });
});
