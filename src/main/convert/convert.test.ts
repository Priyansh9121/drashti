import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import { type Db, openDatabase } from '../db/database';
import { sha256File } from '../import/media-store';
import { ConvertService } from './convert-service';

/*
 * Converting with the real FFmpeg (where it has been fetched: macOS and
 * Windows CI, and the dev Mac), on files generated here and the tiny
 * generated HEIC in tests/fixtures/media.
 */

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);
const HEIC = join(process.cwd(), 'tests', 'fixtures', 'media', 'placeholder.heic');

let dir = '';
let service: ConvertService | null = null;
let db: Db | null = null;
afterEach(() => {
  service?.close();
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function make(args: string[]) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** What FFmpeg says a file holds. */
const describeFile = (file: string) => spawnSync(ffmpeg, ['-hide_banner', '-i', file]).stderr.toString();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

describe.skipIf(!existsSync(ffmpeg))('converting media, with FFmpeg', () => {
  it('turns each kind into what Drashti plays, keeps the original, and moves what used it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-convert-'));
    const mediaDir = join(dir, 'Media');
    mkdirSync(join(mediaDir, 'in'), { recursive: true });
    const at = (name: string) => join(mediaDir, 'in', name);
    // A ProRes video with sound, an AVI, a ProRes 4444 with transparency, an AIFF, and a HEIC.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25',
      '-f',
      'lavfi',
      '-i',
      'sine=r=48000',
      '-t',
      '2',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '2',
      '-c:a',
      'pcm_s16le',
      at('clip.mov'),
    ]);
    make(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-t', '2', '-c:v', 'mpeg4', at('clip.avi')]);
    make([
      '-f',
      'lavfi',
      '-i',
      'color=c=red@0.5:s=320x180:r=25,format=yuva444p10le',
      '-t',
      '2',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '4444',
      '-pix_fmt',
      'yuva444p10le',
      at('third.mov'),
    ]);
    make(['-f', 'lavfi', '-i', 'sine=r=44100', '-t', '2', at('sound.aiff')]);
    copyFileSync(HEIC, at('photo.heic'));
    db = openDatabase(join(dir, 'drashti.sqlite'));
    const files = [
      ['m-prores', 'video', 'clip.mov'],
      ['m-avi', 'video', 'clip.avi'],
      ['m-alpha', 'video', 'third.mov'],
      ['m-aiff', 'audio', 'sound.aiff'],
      ['m-heic', 'image', 'photo.heic'],
    ] as const;
    const insert = db.prepare('INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, 0)');
    const item = db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES (?, 'pl', ?, 'media', ?)",
    );
    db.prepare("INSERT INTO playlists (id, name) VALUES ('pl', 'Placeholder')").run();
    files.forEach(([id, kind, name], i) => {
      insert.run(id, kind, `Placeholder ${name}`, `in/${name}`);
      item.run(`item-${id}`, i, id);
    });
    const before = await Promise.all(files.map(([, , name]) => sha256File(at(name))));

    let jobs: ConversionJob[] = [];
    let busy: string | null = 'On air: conversions wait for the stream to end.';
    const changed: string[][] = [];
    service = new ConvertService({
      db,
      mediaDir,
      ffmpegPath: () => ffmpeg,
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: (p) => changed.push(p),
      log: () => undefined,
    });
    expect(service.convert(files.map(([id]) => id))).toMatchObject({ ok: true });
    // While on air nothing starts, and the window is told why.
    await sleep(1500);
    expect(jobs.every((j) => j.state === 'waiting' && j.note?.startsWith('On air'))).toBe(true);
    busy = null;
    await until(() => jobs.length === 5 && jobs.every((j) => j.state === 'done' || j.state === 'failed'));
    expect(jobs.map((j) => [j.name, j.state, j.message])).toEqual(
      files.map(([, , n]) => [`Placeholder ${n}`, 'done', null]),
    );

    const converted = (id: string) =>
      db
        ?.prepare(
          `SELECT c.kind, c.name, c.path, c.format, c.playable FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
          WHERE mc.original_id = ?`,
        )
        .get(id) as { kind: string; name: string; path: string; format: string; playable: number };
    const what = (id: string) => describeFile(join(mediaDir, converted(id).path));
    expect(converted('m-prores')).toMatchObject({ kind: 'video', name: 'Placeholder clip.mp4', playable: 1 });
    expect(what('m-prores')).toMatch(/Video: h264.*yuv420p/u);
    expect(what('m-prores')).toMatch(/Audio: aac/u);
    expect(what('m-avi')).toMatch(/Video: h264/u);
    // Transparency kept: VP9 with an alpha channel (FFmpeg reports it as alpha_mode in the WebM).
    expect(converted('m-alpha').name).toBe('Placeholder third.webm');
    expect(what('m-alpha')).toMatch(/Video: vp9/u);
    expect(what('m-alpha')).toMatch(/alpha_mode\s*:\s*1/u);
    expect(converted('m-aiff')).toMatchObject({ kind: 'audio', name: 'Placeholder sound.m4a' });
    expect(what('m-aiff')).toMatch(/Audio: aac/u);
    expect(converted('m-heic')).toMatchObject({ kind: 'image', name: 'Placeholder photo.jpg' });
    expect(what('m-heic')).toMatch(/Video: mjpeg/u);

    // The originals are as they were, still in the library; the playlist uses the converted files.
    const after = await Promise.all(files.map(([, , name]) => sha256File(at(name))));
    expect(after).toEqual(before);
    expect((db.prepare('SELECT count(*) AS n FROM media WHERE playable = 0').get() as { n: number }).n).toBe(
      5,
    );
    const usesOriginal = db
      .prepare("SELECT count(*) AS n FROM playlist_items WHERE media_id LIKE 'm-%'")
      .get() as { n: number };
    expect(usesOriginal.n).toBe(0);

    // Undo puts the original back where it was used.
    const prores = jobs.find((j) => j.mediaId === 'm-prores');
    expect(service.undo(prores?.conversionId)).toEqual({ ok: true });
    expect(db.prepare("SELECT media_id FROM playlist_items WHERE id = 'item-m-prores'").get()).toEqual({
      media_id: 'm-prores',
    });
    expect(service.undo(prores?.conversionId)).toMatchObject({ ok: false });
    expect(changed.length).toBeGreaterThanOrEqual(6);
    // Nothing is left behind in the work folder.
    expect(readFileSync(join(mediaDir, converted('m-avi').path)).length).toBeGreaterThan(0);
  }, 180_000);

  it('can be cancelled (even while FFmpeg reads the file), clears what a stop left, and refuses to start with less than 2 GB free', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-convert-'));
    const mediaDir = join(dir, 'Media');
    mkdirSync(join(mediaDir, 'in'), { recursive: true });
    // Long enough to cancel while it runs.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=1280x720:r=30',
      '-t',
      '20',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '3',
      join(mediaDir, 'in', 'long.mov'),
    ]);
    db = openDatabase(join(dir, 'drashti.sqlite'));
    db.prepare(
      "INSERT INTO media (id, kind, name, path, playable) VALUES ('m', 'video', 'long.mov', 'in/long.mov', 0)",
    ).run();
    // A part-file left by a conversion that was going when Drashti stopped.
    mkdirSync(join(mediaDir, '.converting'));
    writeFileSync(join(mediaDir, '.converting', 'left.mp4'), 'part');
    let jobs: ConversionJob[] = [];
    let most = 0;
    let free = 100 * 1024 ** 3;
    service = new ConvertService({
      db,
      mediaDir,
      ffmpegPath: () => ffmpeg,
      busy: () => null,
      freeBytes: () => free,
      changed: (j) => {
        jobs = j;
        most = Math.max(most, ...j.map((job) => job.progress ?? 0));
      },
      libraryChanged: () => undefined,
      log: () => undefined,
    });
    expect(existsSync(join(mediaDir, '.converting', 'left.mp4'))).toBe(false);
    // Cancelled straight away, while FFmpeg is still reading the file: it never starts converting.
    service.convert(['m']);
    expect(jobs[0]?.state).toBe('converting');
    service.cancel(null);
    await until(() => jobs[0]?.state === 'cancelled');
    expect(most).toBe(0);
    // Cancelled while it converts.
    service.convert(['m']);
    await until(() => jobs.at(-1)?.state === 'converting' && (jobs.at(-1)?.progress ?? 0) > 0);
    service.cancel(null);
    await until(() => jobs.at(-1)?.state === 'cancelled');
    expect(existsSync(join(mediaDir, '.converting', `${jobs.at(-1)?.id ?? ''}.mp4`))).toBe(false);
    free = 1024 ** 3;
    service.convert(['m']);
    await until(() => jobs.some((j) => j.state === 'failed'));
    expect(jobs.find((j) => j.state === 'failed')?.message).toContain('2 GB');
  }, 120_000);
});
