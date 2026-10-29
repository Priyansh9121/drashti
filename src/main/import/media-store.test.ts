import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseFfmpegInfo } from '../convert/plan';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { MediaRemoval } from '../library/media-removal';
import { MediaStore, type MediaStoreOptions } from './media-store';

const GiB = 1024 ** 3;

function setup(freeBytes = 100 * GiB) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-media-'));
  const mediaDir = join(dir, 'Media');
  const sourceDir = join(dir, 'source');
  mkdirSync(mediaDir);
  mkdirSync(sourceDir);
  const db = openDatabase(':memory:');
  const store = new MediaStore(db, { dir: mediaDir, freeBytes: () => freeBytes });
  const file = (name: string, content: string) => {
    const path = join(sourceDir, name);
    writeFileSync(path, content);
    return path;
  };
  return { db, store, mediaDir, file };
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const storedFiles = (mediaDir: string) =>
  readdirSync(mediaDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

describe('MediaStore', () => {
  it('lists only what was imported as media: a page Drashti drew is not, until the same picture is dropped in on its own (Session 26a)', async () => {
    const { db, store, file } = setup();
    const page = file('page-0001.png', 'placeholder page bytes');
    const stage = await store.stage(page);
    if (!stage.ok) throw new Error('not staged');
    const drawn = store.addStaged(stage.staged, { kind: 'drashti', path: '/decks/Katha.pdf#page=1' });
    const listed = () => new MediaRepo(db).list().map((m) => m.id);
    expect(listed()).toEqual([]);
    // The same bytes dropped in as a picture: the shared row is listed from then on.
    const same = file('Placeholder same picture.png', 'placeholder page bytes');
    const again = await store.importFile(same, { kind: 'media', path: same });
    expect(again).toMatchObject({ outcome: 'skipped', mediaId: drawn.mediaId });
    expect(listed()).toEqual([drawn.mediaId]);
    // And a deck drawing a page already listed leaves it listed.
    const other = file('Placeholder photo.png', 'placeholder photo bytes');
    const photo = await store.importFile(other, { kind: 'media', path: other });
    const stage2 = await store.stage(other);
    if (!stage2.ok || !('mediaId' in photo)) throw new Error('not staged');
    store.addStaged(stage2.staged, { kind: 'drashti', path: '/decks/Other.pdf#page=4' });
    expect(listed().sort()).toEqual([drawn.mediaId, photo.mediaId].sort());
  });

  it('brings deleted media back to life when the same file is imported again, even once its file has gone (Session 26a)', async () => {
    const { db, store, mediaDir, file } = setup();
    const path = file('Placeholder darshan.png', 'placeholder picture bytes');
    const first = await store.importFile(path, { kind: 'media', path });
    if (!('mediaId' in first)) throw new Error('not imported');
    const removal = new MediaRemoval(db, { onScreens: () => new Set() });
    removal.remove([first.mediaId]);
    // Imported again before the next start: the same item, no longer deleted.
    const again = await store.importFile(path, { kind: 'media', path });
    expect(again).toMatchObject({ outcome: 'imported', mediaId: first.mediaId });
    expect(db.prepare('SELECT deleted_at FROM media').get()).toEqual({ deleted_at: null });
    // Deleted, gone for good at a start (its file removed), then imported again: back with a file.
    removal.remove([first.mediaId]);
    expect(await removal.purge(mediaDir, new Set())).toBe(1);
    expect(storedFiles(mediaDir)).toEqual([]);
    const third = await store.importFile(path, { kind: 'media', path });
    expect(third).toMatchObject({ outcome: 'imported', mediaId: first.mediaId });
    expect(db.prepare("SELECT path <> '' AS has, missing, deleted_at FROM media").get()).toEqual({
      has: 1,
      missing: 0,
      deleted_at: null,
    });
    expect(storedFiles(mediaDir)).toHaveLength(1);
    // Imported once more, nothing deleted: as before, skipped.
    expect(await store.importFile(path, { kind: 'media', path })).toMatchObject({ outcome: 'skipped' });
  });

  it('copies a media file in under its sha256 and records where it came from', async () => {
    const { db, store, mediaDir, file } = setup();
    const path = file('Background Loop.MP4', 'placeholder video bytes');
    const result = await store.importFile(path, { kind: 'media', path });
    const hash = sha('placeholder video bytes');
    expect(result).toMatchObject({
      outcome: 'imported',
      sha256: hash,
      bytes: 23,
      name: 'Background Loop.MP4',
    });
    const stored = join(mediaDir, hash.slice(0, 2), `${hash}.mp4`);
    expect(readFileSync(stored, 'utf8')).toBe('placeholder video bytes');
    expect(readFileSync(path, 'utf8')).toBe('placeholder video bytes');
    expect(
      db.prepare('SELECT kind, name, path, bytes, missing, source_kind, source_path FROM media').get(),
    ).toEqual({
      kind: 'video',
      name: 'Background Loop.MP4',
      path: `${hash.slice(0, 2)}/${hash}.mp4`,
      bytes: 23,
      missing: 0,
      source_kind: 'media',
      source_path: path,
    });
  });

  it('stores the same bytes once, whatever the file is called', async () => {
    const { db, store, mediaDir, file } = setup();
    const a = file('a.png', 'same image');
    const b = file('b copy.png', 'same image');
    const first = await store.importFile(a, { kind: 'media', path: a });
    const second = await store.importFile(b, { kind: 'media', path: b });
    expect(second).toMatchObject({ outcome: 'skipped', name: 'a.png' });
    expect(
      second.outcome !== 'failed' && first.outcome !== 'failed' && second.mediaId === first.mediaId,
    ).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 1 });
    expect(storedFiles(mediaDir)).toHaveLength(1);
  });

  it('refuses to copy when the disk would drop below the reserve, and copies nothing', async () => {
    const { db, store, mediaDir, file } = setup(2 * GiB + 10);
    const path = file('big.mov', 'x'.repeat(100));
    const result = await store.importFile(path, { kind: 'media', path });
    expect(result).toMatchObject({
      outcome: 'failed',
      issue: { code: 'no-space', fix: { kind: 'free-space' } },
    });
    expect(result.outcome === 'failed' && result.issue.fix).toEqual({ kind: 'free-space', neededBytes: 90 });
    expect(storedFiles(mediaDir)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 0 });
  });

  it('turns down files that are not media, and files it cannot read', async () => {
    const { store, file } = setup();
    const txt = file('notes.txt', 'x');
    expect(await store.importFile(txt, { kind: 'media', path: txt })).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-media' },
    });
    const gone = join(tmpdir(), 'drashti-no-such-file.png');
    expect(await store.importFile(gone, { kind: 'media', path: gone })).toMatchObject({
      outcome: 'failed',
      issue: { code: 'unreadable', fix: { kind: 'import-again', sourcePath: gone } },
    });
  });

  it('keeps a missing file as one missing item per original path, then fills it in keeping its id', async () => {
    const { db, store, file } = setup();
    const original = 'C:\\Users\\Media\\Old Loop.mov';
    const id = store.addMissing(original, 'video', { kind: 'pp7', path: original });
    expect(store.addMissing(original, 'video', { kind: 'pp7', path: original })).toBe(id);
    expect(store.missing()).toEqual([{ id, name: 'Old Loop.mov', kind: 'video', originalPath: original }]);

    const found = file('Old Loop.mov', 'found loop');
    const filled = await store.fillMissing(id, found);
    expect(filled).toMatchObject({ outcome: 'imported', mediaId: id, sha256: sha('found loop') });
    expect(store.missing()).toEqual([]);
    expect(db.prepare('SELECT missing, bytes FROM media WHERE id = ?').get(id)).toEqual({
      missing: 0,
      bytes: 10,
    });
  });

  it('merges a missing item into one that already has the same bytes', async () => {
    const { db, store, file } = setup();
    const path = file('loop.mov', 'shared bytes');
    const existing = await store.importFile(path, { kind: 'media', path });
    const missingId = store.addMissing('/Volumes/Old/loop.mov', 'video', {
      kind: 'pp6',
      path: '/Volumes/Old/loop.mov',
    });
    const repoint = vi.fn();
    const result = await store.fillMissing(missingId, path, repoint);
    const existingId = existing.outcome === 'failed' ? '' : existing.mediaId;
    expect(result).toMatchObject({ outcome: 'skipped', mediaId: existingId });
    expect(repoint).toHaveBeenCalledWith(missingId, existingId);
    expect(db.prepare('SELECT id FROM media').all()).toEqual([{ id: existingId }]);
    expect(await store.fillMissing(missingId, path)).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-missing' },
    });
  });

  it('leaves no partial file behind when a copy fails', async () => {
    const { store, mediaDir, file } = setup();
    const path = file('clip.mp4', 'clip');
    // A file where the two-letter folder should be makes the copy fail.
    writeFileSync(join(mediaDir, sha('clip').slice(0, 2)), 'in the way');
    const result = await store.importFile(path, { kind: 'media', path });
    expect(result.outcome).toBe('failed');
    expect(existsSync(join(mediaDir, sha('clip').slice(0, 2)))).toBe(true);
    expect(storedFiles(mediaDir)).toEqual([sha('clip').slice(0, 2)]);
  });
});

/**
 * What the bundled FFmpeg reads in each kind of file (Session 50), stood in for by the file's extension: the
 * stored copy keeps it. FFmpeg's own words, as it printed them for tiny generated files.
 */
const READS: Record<string, string> = {
  mkv: [
    "Input #0, matroska,webm, from '/x.mkv':",
    '  Duration: 00:00:01.01, start: 0.000000, bitrate: 137 kb/s',
    '  Stream #0:0: Video: h264 (Constrained Baseline), yuv420p(tv, progressive), 64x48, 10 fps, 10 tbr, 1k tbn',
    '  Stream #0:1: Audio: ac3, 48000 Hz, mono, fltp, 96 kb/s',
  ].join('\n'),
  flac: [
    "Input #0, flac, from '/x.flac':",
    '  Duration: 00:00:01.00, start: 0.000000, bitrate: 202 kb/s',
    '  Stream #0:0: Audio: flac, 48000 Hz, mono, s16',
  ].join('\n'),
  mp4: [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/x.mp4':",
    '  Duration: 00:00:01.00, start: 0.000000, bitrate: 117 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 64x48, 31 kb/s, 10 fps, 10 tbr, 10240 tbn (default)',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 70 kb/s (default)',
  ].join('\n'),
  mov: [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/x.mov':",
    '  Duration: 00:00:03.00, start: 0.000000, bitrate: 51 kb/s',
    '  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, progressive), 320x180, 51 kb/s, 25 fps, 25 tbr, 12800 tbn (default)',
  ].join('\n'),
  wma: [
    "Input #0, asf, from '/x.wma':",
    '  Duration: 00:00:01.03, start: 0.000000, bitrate: 154 kb/s',
    '  Stream #0:0: Audio: wmav2 (a[1][0][0] / 0x0161), 48000 Hz, mono, fltp, 128 kb/s',
  ].join('\n'),
  ts: [
    "Input #0, mpegts, from '/x.ts':",
    '  Duration: 00:00:01.02, start: 1.400000, bitrate: 153 kb/s',
    '  Stream #0:0[0x100]: Video: h264 (Constrained Baseline) ([27][0][0][0] / 0x001B), yuv420p(progressive), 64x48, 10 fps, 10 tbr, 90k tbn',
  ].join('\n'),
};

/** A store whose FFmpeg reads files as READS says, noting each file it was asked to read. */
function checking(
  options: Partial<Pick<MediaStoreOptions, 'readInfo' | 'playsHevc'>> & {
    reads?: Record<string, string>;
  } = {},
) {
  const t = setup();
  const asked: string[] = [];
  const reads = options.reads ?? READS;
  const store = new MediaStore(t.db, {
    dir: t.mediaDir,
    freeBytes: () => 100 * GiB,
    ...(options.playsHevc === undefined ? {} : { playsHevc: options.playsHevc }),
    readInfo:
      options.readInfo ??
      ((file) => {
        asked.push(extname(file).slice(1));
        return Promise.resolve(parseFfmpegInfo(reads[extname(file).slice(1)] ?? ''));
      }),
  });
  const take = async (name: string, content: string | Buffer) => {
    const path = join(t.mediaDir, '..', 'source', name);
    writeFileSync(path, content);
    return store.importFile(path, { kind: 'media', path });
  };
  return { ...t, store, asked, take };
}

const rows = (db: ReturnType<typeof setup>['db']) =>
  db.prepare('SELECT name, playable, format FROM media ORDER BY name').all();

describe('every video and sound read with FFmpeg at import (Session 50)', () => {
  it('marks what Drashti’s player cannot play, to be converted by itself, and never what plays', async () => {
    const t = checking();
    expect(await t.take('Placeholder katha.mkv', 'placeholder mkv')).toMatchObject({
      outcome: 'imported',
      convert: true,
      probe: { playable: false, format: 'H.264 video with AC-3 sound (Matroska)', kind: 'video' },
    });
    expect(await t.take('Placeholder bhajan.wma', 'placeholder wma')).toMatchObject({
      convert: true,
      probe: { playable: false, format: 'Windows Media Audio sound file', kind: 'audio' },
    });
    const flac = await t.take('Placeholder dhun.flac', 'placeholder flac');
    expect(flac).toMatchObject({ probe: { playable: true, format: 'FLAC sound file', kind: 'audio' } });
    const mp4 = await t.take('Placeholder clip.mp4', 'placeholder mp4');
    expect(mp4).toMatchObject({ probe: { playable: true, format: 'H.264 video with AAC sound (MP4)' } });
    for (const plays of [flac, mp4]) expect(plays.outcome !== 'failed' && plays.convert).toBeFalsy();
    // HEVC: the window knows whether this computer plays it; the import does not convert it.
    const hevc = await t.take('Placeholder phone.mov', 'placeholder mov');
    expect(hevc).toMatchObject({ probe: { playable: null, format: 'HEVC (H.265) video (QuickTime)' } });
    expect(hevc.outcome !== 'failed' && hevc.convert).toBeFalsy();
    // A picture a screen shows as it is is not read with FFmpeg (Session 55: one nothing can read is turned down).
    await t.take(
      'Placeholder darshan.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]),
    );
    expect(t.asked.sort()).toEqual(['flac', 'mkv', 'mov', 'mp4', 'wma']);
    expect(rows(t.db)).toEqual([
      { name: 'Placeholder bhajan.wma', playable: 0, format: 'Windows Media Audio sound file' },
      { name: 'Placeholder clip.mp4', playable: 1, format: 'H.264 video with AAC sound (MP4)' },
      { name: 'Placeholder darshan.png', playable: 1, format: 'PNG picture' },
      { name: 'Placeholder dhun.flac', playable: 1, format: 'FLAC sound file' },
      { name: 'Placeholder katha.mkv', playable: 0, format: 'H.264 video with AC-3 sound (Matroska)' },
      { name: 'Placeholder phone.mov', playable: null, format: 'HEVC (H.265) video (QuickTime)' },
    ]);
  });

  it('HEVC (Session 51): converted by itself where this computer cannot play it; where it can, it plays as it is', async () => {
    const cannot = checking({ playsHevc: false });
    expect(await cannot.take('Placeholder phone.mov', 'placeholder mov')).toMatchObject({
      outcome: 'imported',
      convert: true,
      probe: { playable: false, format: 'HEVC (H.265) video (QuickTime)', kind: 'video' },
    });
    expect(rows(cannot.db)).toEqual([
      { name: 'Placeholder phone.mov', playable: 0, format: 'HEVC (H.265) video (QuickTime)' },
    ]);
    for (const playsHevc of [true, null]) {
      const can = checking({ playsHevc });
      const plays = await can.take('Placeholder phone.mov', 'placeholder mov');
      expect(plays).toMatchObject({ probe: { playable: null, format: 'HEVC (H.265) video (QuickTime)' } });
      expect(plays.outcome !== 'failed' && plays.convert).toBeFalsy();
    }
  });

  it('keeps what the file’s own header says when FFmpeg reads nothing in it, fails, or takes too long', async () => {
    const avi = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI '), Buffer.alloc(32)]);
    const nothing = checking({ reads: {} });
    expect(await nothing.take('Placeholder old.avi', avi)).toMatchObject({
      probe: { playable: false, format: 'AVI video', kind: 'video' },
    });
    expect(nothing.asked).toEqual(['avi']);
    for (const readInfo of [
      () => Promise.reject(new Error('FFmpeg is gone')),
      () => Promise.resolve({ ...parseFfmpegInfo(READS['mkv'] ?? ''), timedOut: true as const }),
    ]) {
      const t = checking({ readInfo });
      const result = await t.take('Placeholder old.avi', avi);
      expect(result).toMatchObject({ probe: { playable: false, format: 'AVI video' } });
      expect(result.outcome !== 'failed' && result.convert).toBeFalsy();
    }
  });

  it('marks a file imported before by what FFmpeg reads now, when the same bytes come again', async () => {
    const t = checking();
    // Imported before Session 50 (no FFmpeg): an MKV its header could not judge, a FLAC it could.
    const before = new MediaStore(t.db, { dir: t.mediaDir, freeBytes: () => 100 * GiB });
    for (const name of ['Placeholder katha.mkv', 'Placeholder phone.mov']) {
      const path = join(t.mediaDir, '..', 'source', name);
      writeFileSync(path, `placeholder ${name}`);
      await before.importFile(path, { kind: 'media', path });
    }
    t.db
      .prepare("UPDATE media SET playable = 1, format = 'MOV video' WHERE name = 'Placeholder phone.mov'")
      .run();
    expect(await t.take('Placeholder katha.mkv', 'placeholder Placeholder katha.mkv')).toMatchObject({
      outcome: 'skipped',
      convert: true,
      probe: { playable: false },
    });
    // HEVC says nothing new about a file known to play: left as it was.
    await t.take('Placeholder phone.mov', 'placeholder Placeholder phone.mov');
    expect(rows(t.db)).toEqual([
      { name: 'Placeholder katha.mkv', playable: 0, format: 'H.264 video with AC-3 sound (Matroska)' },
      { name: 'Placeholder phone.mov', playable: 1, format: 'MOV video' },
    ]);
  });

  it('keeps each video’s and sound’s length FFmpeg read, before it has played (Session 55, Part 7, P3)', async () => {
    const t = checking();
    await t.take('Placeholder clip.mp4', 'placeholder mp4');
    await t.take('Placeholder dhun.flac', 'placeholder flac');
    await t.take('Placeholder darshan.png', 'placeholder png');
    const lengths = () => t.db.prepare('SELECT name, duration_ms FROM media ORDER BY name').all();
    expect(lengths()).toEqual([
      { name: 'Placeholder clip.mp4', duration_ms: 1000 },
      { name: 'Placeholder darshan.png', duration_ms: null },
      { name: 'Placeholder dhun.flac', duration_ms: 1000 },
    ]);
    // Imported before (no length then): the same bytes again keep the length read now, never a length known already.
    t.db.prepare("UPDATE media SET duration_ms = NULL WHERE name = 'Placeholder clip.mp4'").run();
    t.db.prepare("UPDATE media SET duration_ms = 999 WHERE name = 'Placeholder dhun.flac'").run();
    await t.take('Placeholder clip.mp4', 'placeholder mp4');
    await t.take('Placeholder dhun.flac', 'placeholder flac');
    expect(lengths()).toEqual([
      { name: 'Placeholder clip.mp4', duration_ms: 1000 },
      { name: 'Placeholder darshan.png', duration_ms: null },
      { name: 'Placeholder dhun.flac', duration_ms: 999 },
    ]);
  });

  it('turns down a .ts file that is no video (TypeScript, say), copying nothing; takes a transport stream', async () => {
    const t = checking({ reads: {} });
    expect(await t.take('Placeholder notes.ts', 'export const placeholder = 1;\n')).toEqual({
      outcome: 'failed',
      issue: {
        severity: 'error',
        code: 'not-media',
        message: 'Placeholder notes.ts is not a video Drashti can read.',
        fix: null,
      },
    });
    expect(storedFiles(t.mediaDir)).toEqual([]);
    // An MPEG transport stream: a sync byte every 188 bytes.
    const stream = Buffer.alloc(188 * 3);
    for (let at = 0; at < stream.length; at += 188) stream[at] = 0x47;
    expect(await t.take('Placeholder sabha.ts', stream)).toMatchObject({
      outcome: 'imported',
      probe: { format: 'MPEG transport stream video' },
    });
    // One FFmpeg reads, whatever its first bytes say.
    const read = checking();
    expect(await read.take('Placeholder recording.ts', 'placeholder stream')).toMatchObject({
      outcome: 'imported',
      convert: true,
      probe: { playable: false, format: 'H.264 video (MPEG transport stream)' },
    });
  });
});

/** What the bundled FFmpeg reads in pictures (Session 55, Part 5), as it printed them for tiny generated files. */
const PICTURE_READS: Record<string, string> = {
  heic: [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/x.heic':",
    '  Duration: N/A, start: 0.000000, bitrate: N/A',
    '  Stream #0:0[0x1]: Video: hevc (Main Still Picture) (hvc1 / 0x31637668), yuvj420p(pc, smpte170m/unknown/unknown), 64x48, 1 fps, 1 tbr, 1 tbn (default)',
  ].join('\n'),
  tga: [
    "Input #0, image2, from '/x.tga':",
    '  Duration: 00:00:00.04, start: 0.000000, bitrate: 56 kb/s',
    '  Stream #0:0: Video: targa, bgra, 64x48, 25 fps, 25 tbr, 25 tbn',
  ].join('\n'),
  tif: [
    "Input #0, tiff_pipe, from '/x.tif':",
    '  Duration: N/A, bitrate: N/A',
    '  Stream #0:0: Video: tiff, rgb24, 64x48 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn',
  ].join('\n'),
  // FFmpeg could not open it: no picture, no sound.
  png: [
    '[in#0 @ 0x14fe15410] Error opening input: Invalid data found when processing input',
    'Error opening input file /x.png.',
  ].join('\n'),
  // A sound called a picture.
  jpg: [
    "Input #0, mp3, from '/x.jpg':",
    '  Duration: 00:00:01.00, start: 0.000000, bitrate: 128 kb/s',
    '  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 128 kb/s',
  ].join('\n'),
};

describe('every picture type, every way in (Session 55, Part 5)', () => {
  const HEIC = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypheic'),
    Buffer.alloc(4),
    Buffer.from('mif1heic'),
    Buffer.alloc(32),
  ]);
  const TIFF = Buffer.concat([Buffer.from('II*\0'), Buffer.alloc(64)]);
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);

  it('converts by itself a picture a screen cannot show as it is, once FFmpeg reads it: HEIC, TIFF, a Targa', async () => {
    const t = checking({ reads: PICTURE_READS });
    expect(await t.take('Placeholder photo.heic', HEIC)).toMatchObject({
      outcome: 'imported',
      convert: true,
      probe: { playable: false, format: 'HEIC photo', kind: 'image' },
    });
    expect(await t.take('Placeholder scan.tif', TIFF)).toMatchObject({
      convert: true,
      probe: { playable: false, format: 'TIFF picture', kind: 'image' },
    });
    // A Targa has no first bytes of its own: FFmpeg says what it is.
    expect(await t.take('Placeholder logo.tga', Buffer.alloc(80, 7))).toMatchObject({
      outcome: 'imported',
      convert: true,
      probe: { playable: false, format: 'Targa picture', kind: 'image' },
    });
    // One a screen shows as it is is never read with FFmpeg, nor converted.
    const png = await t.take('Placeholder darshan.png', PNG);
    expect(png).toMatchObject({ outcome: 'imported', probe: { playable: true, format: 'PNG picture' } });
    expect(png.outcome !== 'failed' && png.convert).toBeFalsy();
    expect(t.asked.sort()).toEqual(['heic', 'tga', 'tif']);
  });

  it('turns down, with the reason, a “picture” nothing can read, copying nothing', async () => {
    const t = checking({ reads: PICTURE_READS });
    expect(await t.take('Placeholder broken.png', 'placeholder text, not a picture')).toEqual({
      outcome: 'failed',
      issue: {
        severity: 'error',
        code: 'not-a-picture',
        message:
          'Placeholder broken.png is not a picture Drashti can read: what is inside it is not a picture (it may be damaged, or another kind of file with a picture’s name).',
        fix: null,
      },
    });
    // A sound called a picture is no picture either.
    expect(await t.take('Placeholder song.jpg', 'placeholder mp3 bytes')).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-a-picture' },
    });
    // A HEIC FFmpeg cannot open (damaged) is turned down too.
    expect(await checking({ reads: {} }).take('Placeholder photo.heic', HEIC)).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-a-picture' },
    });
    expect(storedFiles(t.mediaDir)).toEqual([]);
  });

  it('keeps the file’s own header’s judgement where there is no FFmpeg to read it', async () => {
    const { store, file } = setup();
    expect(
      await store.importFile(file('Placeholder photo.heic', 'placeholder heic'), {
        kind: 'media',
        path: 'x',
      }),
    ).toMatchObject({ outcome: 'imported' });
  });
});

describe('an import’s new points for a file the library has (Session 55: the owner’s answer to question 20)', () => {
  it('takes them in place of its own; says new, replaced or the same (their ids aside); never on a picture', async () => {
    const { db, store, file } = setup();
    const clip = await store.importFile(file('Placeholder clip.mp4', 'placeholder clip'), {
      kind: 'media',
      path: 'x',
    });
    const picture = await store.importFile(file('Placeholder photo.png', 'placeholder photo'), {
      kind: 'media',
      path: 'y',
    });
    if (clip.outcome === 'failed' || picture.outcome === 'failed') throw new Error('not imported');
    const points = (startMs: number, name: string) => ({
      startMs,
      endMs: null,
      markers: [{ id: `m-${name}-${String(startMs)}`, name, atMs: startMs + 1000 }],
    });
    expect(store.takeMarkers(clip.mediaId, points(2000, 'Katha'))).toBe('new');
    expect(
      store.takeMarkers(clip.mediaId, {
        ...points(2000, 'Katha'),
        markers: [{ id: 'other', name: 'Katha', atMs: 3000 }],
      }),
    ).toBe('same');
    expect(store.takeMarkers(clip.mediaId, points(4000, 'Arti'))).toBe('replaced');
    expect(new MediaRepo(db).markersOf(clip.mediaId)).toMatchObject({
      startMs: 4000,
      markers: [{ name: 'Arti', atMs: 5000 }],
    });
    expect(store.takeMarkers(picture.mediaId, points(1000, 'x'))).toBeNull();
    expect(store.takeMarkers('no-such-item', points(1000, 'x'))).toBeNull();
  });
});
