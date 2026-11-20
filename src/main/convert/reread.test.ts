import { describe, expect, it } from 'vitest';
import { type Db, LIBRARY_BUSY_TIMEOUT_MS, openDatabase } from '../db/database';
import { parseFfmpegInfo, type MediaInfo } from './plan';
import { Reread } from './reread';

/*
 * The idle sweep (alpha.20, "Plays anything"): every video and sound FFmpeg never read (a library from before Session
 * 50) is read once, one at a time, and what FFmpeg reads decides as at an import. FFmpeg's reading is a stand-in here,
 * FFmpeg 9.0.2's own words for generated files, by the file's name.
 */

const READS: Record<string, string> = {
  'Placeholder 8K.mp4': `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/8k.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 96824 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 7680x4320 [SAR 1:1 DAR 16:9], 96745 kb/s, 10 fps, 10 tbr, 10240 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 69 kb/s (default)`,
  'Placeholder 1080i.mp4': `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/1080i.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 1219 kb/s
  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(top first), 640x360 [SAR 1:1 DAR 16:9], 1147 kb/s, 10 fps, 10 tbr, 10240 tbn (default)`,
  'Placeholder clip.mp4': `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/clip.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 830 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 69 kb/s (default)`,
  'Placeholder phone.mov': `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/phone.mov':
  Duration: 00:00:03.00, start: 0.000000, bitrate: 51 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, progressive), 320x180, 51 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`,
};

function library(): { db: Db; add: (id: string, name: string, more?: Record<string, unknown>) => void } {
  const db = openDatabase(':memory:');
  const add = (id: string, name: string, more: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      id,
      kind: name.endsWith('.png') ? 'image' : 'video',
      name,
      path: `in/${id}`,
      playable: 1,
      format: 'H.264 video (MP4)',
      ...more,
    };
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO media (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
      ...Object.values(row),
    );
  };
  return { db, add };
}

function sweep(
  db: Db,
  options: { read?: (file: string) => (MediaInfo & { timedOut?: true }) | null; ffmpeg?: string | null } = {},
) {
  const read: string[] = [];
  const converted: string[] = [];
  const names = new Map(
    (db.prepare('SELECT path, name FROM media').all() as { path: string; name: string }[]).map((r) => [
      r.path,
      r.name,
    ]),
  );
  const reread = new Reread(
    {
      db,
      mediaDir: '/media',
      ffmpegPath: () => (options.ffmpeg === undefined ? '/bundled/ffmpeg' : options.ffmpeg),
      read: (_ffmpeg, file) => {
        read.push(file);
        const name = names.get(file.replace(/^[/\\]media[/\\]/u, '').replace(/\\/gu, '/')) ?? '';
        return Promise.resolve(options.read ? options.read(name) : parseFfmpegInfo(READS[name] ?? ''));
      },
      convert: (id) => converted.push(id),
      log: () => undefined,
      busyTimeoutMs: LIBRARY_BUSY_TIMEOUT_MS,
    },
    1000,
  );
  return { reread, read, converted };
}

const state = (db: Db, id: string) =>
  db.prepare('SELECT read_by, playable, format FROM media WHERE id = ?').get(id) as {
    read_by: string | null;
    playable: number | null;
    format: string | null;
  };

describe('the idle sweep: what FFmpeg never read, read once', () => {
  it('reads each file FFmpeg never read, oldest first, one a turn, and marks what it read', async () => {
    const { db, add } = library();
    add('a', 'Placeholder clip.mp4');
    add('b', 'Placeholder 8K.mp4');
    const { reread, read, converted } = sweep(db);
    expect(reread.next()?.id).toBe('a');
    expect(await reread.step(10_000)).toBe(true);
    expect(state(db, 'a')).toEqual({
      read_by: 'ffmpeg',
      playable: 1,
      format: 'H.264 video with AAC sound (MP4)',
    });
    // Its turn is not over yet: nothing more is read until a second has passed.
    expect(await reread.step(10_500)).toBe(false);
    expect(await reread.step(11_000)).toBe(true);
    expect(read).toHaveLength(2);
    // The 8K one cannot play as it is: marked so, by its size, and converted by itself.
    expect(state(db, 'b')).toEqual({
      read_by: 'ffmpeg',
      playable: 0,
      format: 'H.264 (7680 × 4320) video with AAC sound (MP4)',
    });
    expect(converted).toEqual(['b']);
    // Nothing is left to read: never read again.
    expect(reread.next()).toBeNull();
    expect(await reread.step(20_000)).toBe(false);
    expect(read).toHaveLength(2);
  });

  it('an interlaced one is converted by itself; HEVC is left to this computer’s window, as at an import', async () => {
    const { db, add } = library();
    add('i', 'Placeholder 1080i.mp4');
    add('h', 'Placeholder phone.mov', { playable: null, format: 'HEVC (H.265) video (QuickTime)' });
    const { reread, converted } = sweep(db);
    await reread.step(1000);
    await reread.step(3000);
    expect(state(db, 'i')).toMatchObject({ read_by: 'ffmpeg', playable: 0 });
    expect(state(db, 'h')).toEqual({
      read_by: 'ffmpeg',
      playable: null,
      format: 'HEVC (H.265) video (QuickTime)',
    });
    expect(converted).toEqual(['i']);
  });

  it('a file FFmpeg reads nothing in, or reads too slowly, keeps its header’s judgement, and is not read again', async () => {
    const { db, add } = library();
    add('d', 'Placeholder damaged.mp4');
    add('t', 'Placeholder slow.mp4', { playable: null, format: 'MP4 file' });
    const { reread, read, converted } = sweep(db, {
      read: (name) =>
        name === 'Placeholder slow.mp4' ? { ...parseFfmpegInfo(''), timedOut: true } : parseFfmpegInfo(''),
    });
    await reread.step(1000);
    await reread.step(3000);
    expect(state(db, 'd')).toEqual({ read_by: 'nothing', playable: 1, format: 'H.264 video (MP4)' });
    expect(state(db, 't')).toEqual({ read_by: 'nothing', playable: null, format: 'MP4 file' });
    expect(converted).toEqual([]);
    expect(await reread.step(5000)).toBe(false);
    expect(read).toHaveLength(2);
  });

  it('never reads a picture, a missing or deleted file, Drashti’s own copy, a converted original, or one read before', async () => {
    const { db, add } = library();
    add('p', 'Placeholder darshan.png', { format: 'PNG picture' });
    add('m', 'Placeholder missing.mp4', { missing: 1, path: '' });
    add('x', 'Placeholder deleted.mp4', { deleted_at: '2026-11-20T12:00:00.000Z' });
    add('o', 'Placeholder original.mp4', { playable: 0 });
    add('c', 'Placeholder copy.mp4', { converted_from: 'o' });
    db.prepare("INSERT INTO media_conversions (id, original_id, converted_id) VALUES ('mc', 'o', 'c')").run();
    add('r', 'Placeholder read.mp4', { read_by: 'ffmpeg' });
    add('n', 'Placeholder nothing.mp4', { read_by: 'nothing' });
    const { reread, read } = sweep(db);
    expect(reread.next()).toBeNull();
    expect(await reread.step(1000)).toBe(false);
    expect(read).toEqual([]);
  });

  it('reads nothing without FFmpeg, and one file at a time', async () => {
    const { db, add } = library();
    add('a', 'Placeholder clip.mp4');
    add('b', 'Placeholder 8K.mp4');
    const none = sweep(db, { ffmpeg: null });
    expect(await none.reread.step(1000)).toBe(false);
    expect(none.read).toEqual([]);
    let release: () => void = () => undefined;
    const slow = new Reread(
      {
        db,
        mediaDir: '/media',
        ffmpegPath: () => '/bundled/ffmpeg',
        read: () =>
          new Promise((resolve) => {
            release = () => {
              resolve(parseFfmpegInfo(READS['Placeholder clip.mp4'] ?? ''));
            };
          }),
        convert: () => undefined,
        log: () => undefined,
        busyTimeoutMs: LIBRARY_BUSY_TIMEOUT_MS,
      },
      0,
    );
    const first = slow.step(1000);
    // Still reading the first: a second turn reads nothing.
    expect(await slow.step(5000)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(state(db, 'a').read_by).toBe('ffmpeg');
  });
});
