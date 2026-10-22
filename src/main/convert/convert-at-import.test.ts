import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import type { ImportIssue } from '../../shared/import';
import { type Db, openDatabase } from '../db/database';
import { MediaStore } from '../import/media-store';
import { playIssues } from '../import/probe';
import { ffmpegHere } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';
import { atImport } from './plan';
import { readInfo } from './read-info';

/*
 * Converting at import (Session 50): what an import finds Drashti's player cannot play is converted by itself,
 * one file at a time, never while the stream is on air or recording, and what plays never is. First the
 * queue with no FFmpeg at all; then the real FFmpeg (where it has been fetched) on tiny generated files: an
 * MKV with AC-3 sound, an AVI, a WMA, an AIFF, a FLAC and an MP4 that plays.
 */

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);

let dir = '';
let service: ConvertService | null = null;
let db: Db | null = null;
afterEach(() => {
  service?.close();
  service = null;
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

/** An import report's lines, as the import writes them. */
const line = (code: string, mediaId: string): { issues: ImportIssue[] } => ({
  issues: [
    {
      severity: 'info',
      code,
      message: 'Placeholder line.',
      fix: { kind: 'convert-media', mediaId, advice: 'Placeholder advice.' },
    },
  ],
});

describe('converting by itself what an import found (Session 50), the queue', () => {
  function seeded() {
    dir = mkdtempSync(join(tmpdir(), 'drashti-convert-at-import-'));
    const mediaDir = join(dir, 'Media');
    mkdirSync(join(mediaDir, 'in'), { recursive: true });
    const library = openDatabase(join(dir, 'drashti.sqlite'));
    db = library;
    const insert = library.prepare(
      'INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [id, kind, name, playable] of [
      ['m-mkv', 'video', 'Placeholder katha.mkv', 0],
      ['m-wma', 'audio', 'Placeholder bhajan.wma', 0],
      ['m-heic', 'image', 'Placeholder photo.heic', 0],
      ['m-flac', 'audio', 'Placeholder dhun.flac', 1],
    ] as const) {
      writeFileSync(join(mediaDir, 'in', name), `placeholder ${name}`);
      insert.run(id, kind, name, `in/${name}`, playable);
    }
    return { mediaDir, library };
  }

  it('takes only the lines that say so, videos and sounds only, each once; asked again, they are being converted', async () => {
    const { mediaDir, library } = seeded();
    let jobs: ConversionJob[] = [];
    const busy = 'Waits while the stream is on air or recording, then carries on by itself.';
    service = new ConvertService({
      db: library,
      mediaDir,
      ffmpegPath: () => join(dir, 'no-ffmpeg-here'),
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
    });
    const report = {
      items: [
        line('converting-media', 'm-mkv'),
        line('converting-media', 'm-wma'),
        // A picture is converted only when someone asks; a file that plays never is.
        line('converting-media', 'm-heic'),
        line('unplayable-media', 'm-heic'),
        line('converting-media', 'm-flac'),
        { issues: [] },
      ],
    };
    expect(service.convertImported(report)).toBe(2);
    expect(jobs.map((j) => [j.mediaId, j.state])).toEqual([
      ['m-mkv', 'waiting'],
      ['m-wma', 'waiting'],
    ]);
    // On air: they wait, and say why.
    expect(jobs.every((j) => j.note === busy)).toBe(true);
    expect(service.convertImported(report)).toBe(0);
    expect(service.convertImported(null)).toBe(0);
    expect(jobs).toHaveLength(2);
    // Asked again by hand (the media list's Convert): they are being converted already.
    expect(service.convert(['m-mkv'])).toMatchObject({ ok: true });
    expect(service.convert(['m-flac'])).toMatchObject({ ok: false });
    expect(jobs).toHaveLength(2);
    await sleep(1500);
    expect(jobs.map((j) => j.state)).toEqual(['waiting', 'waiting']);
  });

  it('starts each one a moment after the import, not at once, and never while the stream is on air', async () => {
    const { mediaDir, library } = seeded();
    let jobs: ConversionJob[] = [];
    let busy: string | null = null;
    service = new ConvertService({
      db: library,
      mediaDir,
      // No FFmpeg there: a job that starts fails at once, which is how this test sees it start.
      ffmpegPath: () => join(dir, 'no-ffmpeg-here'),
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
      limits: { afterImportMs: 2500 },
    });
    expect(service.convertImported({ items: [line('converting-media', 'm-mkv')] })).toBe(1);
    // The timer looks every second: held until 2.5 s after the import.
    await sleep(1800);
    expect(jobs[0]?.state).toBe('waiting');
    await until(() => jobs[0]?.state !== 'waiting', 10_000);
    expect(jobs[0]?.state).toBe('failed');
    // On air meanwhile: the next waits past its moment, until the stream is off.
    busy = 'Waits while the stream is on air or recording, then carries on by itself.';
    expect(service.convertImported({ items: [line('converting-media', 'm-wma')] })).toBe(1);
    await sleep(3500);
    expect(jobs.find((j) => j.mediaId === 'm-wma')).toMatchObject({ state: 'waiting', note: busy });
    busy = null;
    await until(() => jobs.find((j) => j.mediaId === 'm-wma')?.state !== 'waiting', 10_000);
  }, 30_000);
});

function make(args: string[]): void {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** A second of FFmpeg's test picture, 64 × 48, and a tone, as the files Priyansh has. */
const PICTURE = ['-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10'];
const TONE = ['-f', 'lavfi', '-i', 'sine=r=48000:d=1'];

describe.skipIf(!ffmpegHere(ffmpeg))('converting at import, with FFmpeg', () => {
  it('converts an MKV with AC-3 sound, an AVI, a WMA and an AIFF by themselves; a FLAC and an MP4 that play never', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-convert-at-import-'));
    const source = join(dir, 'source');
    const mediaDir = join(dir, 'Media');
    mkdirSync(source);
    mkdirSync(mediaDir);
    const at = (name: string) => join(source, name);
    const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
    make([...PICTURE, ...TONE, '-t', '1', ...x264, '-c:a', 'ac3', at('Placeholder katha.mkv')]);
    make([
      ...PICTURE,
      ...TONE,
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-c:a',
      'libmp3lame',
      at('Placeholder old clip.avi'),
    ]);
    make([...TONE, '-t', '1', '-c:a', 'wmav2', at('Placeholder bhajan.wma')]);
    make([...TONE, '-t', '1', at('Placeholder bell.aiff')]);
    make([...TONE, '-t', '1', at('Placeholder dhun.flac')]);
    make([...PICTURE, ...TONE, '-t', '1', ...x264, '-c:a', 'aac', at('Placeholder clip.mp4')]);
    const names = [
      'Placeholder katha.mkv',
      'Placeholder old clip.avi',
      'Placeholder bhajan.wma',
      'Placeholder bell.aiff',
      'Placeholder dhun.flac',
      'Placeholder clip.mp4',
    ];
    const library = openDatabase(join(dir, 'drashti.sqlite'));
    db = library;
    // The import's own reading: each video and sound read with FFmpeg as it is stored.
    const store = new MediaStore(library, {
      dir: mediaDir,
      freeBytes: () => 100 * 1024 ** 3,
      readInfo: (file) => readInfo(ffmpeg, file),
    });
    const items: { issues: ImportIssue[] }[] = [];
    const ids: Record<string, string> = {};
    for (const name of names) {
      const result = await store.importFile(at(name), { kind: 'media', path: at(name) });
      if (result.outcome === 'failed') throw new Error(result.issue.message);
      ids[name] = result.mediaId;
      items.push({ issues: playIssues(name, result) });
    }
    expect(items.map((i) => i.issues.map((x) => x.code))).toEqual([
      ['converting-media'],
      ['converting-media'],
      ['converting-media'],
      ['converting-media'],
      [],
      [],
    ]);

    let jobs: ConversionJob[] = [];
    let busy: string | null = 'Waits while the stream is on air or recording, then carries on by itself.';
    service = new ConvertService({
      db: library,
      mediaDir,
      ffmpegPath: () => ffmpeg,
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
      limits: { afterImportMs: 0 },
    });
    // The MKV's start and end points and a marker (an imported presentation's, say), and that it came from the
    // drop folder: its copy keeps them (Session 50, section 9's review), so what is relinked plays as before.
    const marks = JSON.stringify({
      startMs: 100,
      endMs: 900,
      markers: [{ id: 'mk1', name: 'Placeholder verse', atMs: 400 }],
    });
    library
      .prepare("UPDATE media SET markers = ?, dropped_at = '2026-10-22T10:00:00.000Z' WHERE id = ?")
      .run(marks, ids['Placeholder katha.mkv']);
    expect(service.convertImported({ items })).toBe(4);
    // Never while on air or recording.
    await sleep(1500);
    expect(jobs.map((j) => j.state)).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    busy = null;
    await until(() => jobs.every((j) => j.state === 'done' || j.state === 'failed'), 120_000);
    expect(jobs.map((j) => [j.name, j.state, j.convertedName])).toEqual([
      ['Placeholder katha.mkv', 'done', 'Placeholder katha.mp4'],
      ['Placeholder old clip.avi', 'done', 'Placeholder old clip.mp4'],
      ['Placeholder bhajan.wma', 'done', 'Placeholder bhajan.m4a'],
      ['Placeholder bell.aiff', 'done', 'Placeholder bell.m4a'],
    ]);
    // What plays was never touched: no job, no copy.
    for (const name of ['Placeholder dhun.flac', 'Placeholder clip.mp4']) {
      expect(
        jobs.find((j) => j.mediaId === ids[name]),
        name,
      ).toBeUndefined();
      expect(
        library.prepare('SELECT count(*) AS n FROM media_conversions WHERE original_id = ?').get(ids[name]),
      ).toEqual({ n: 0 });
    }
    // Each copy plays, by the same rule; the MKV's picture was copied as it was, its sound made AAC.
    const copyOf = (name: string) =>
      library
        .prepare(
          `SELECT c.kind, c.path FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
            WHERE mc.original_id = ?`,
        )
        .get(ids[name]) as { kind: 'video' | 'audio'; path: string };
    for (const name of names.slice(0, 4)) {
      const copy = copyOf(name);
      const info = await readInfo(ffmpeg, join(mediaDir, copy.path));
      expect(atImport(copy.kind, info), name).toBe('plays');
    }
    const mkv = await readInfo(ffmpeg, join(mediaDir, copyOf('Placeholder katha.mkv').path));
    expect(mkv).toMatchObject({ video: { codec: 'h264', width: 64, height: 48 }, audio: { codec: 'aac' } });
    expect(copyOf('Placeholder bhajan.wma').kind).toBe('audio');
    expect(
      library
        .prepare(
          `SELECT c.markers, c.dropped_at FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
            WHERE mc.original_id = ?`,
        )
        .get(ids['Placeholder katha.mkv']),
    ).toEqual({ markers: marks, dropped_at: '2026-10-22T10:00:00.000Z' });
    // The originals stay as they were, marked as Drashti cannot play them.
    expect(
      library.prepare(`SELECT name, playable FROM media WHERE converted_from IS NULL ORDER BY name`).all(),
    ).toEqual([
      { name: 'Placeholder bell.aiff', playable: 0 },
      { name: 'Placeholder bhajan.wma', playable: 0 },
      { name: 'Placeholder clip.mp4', playable: 1 },
      { name: 'Placeholder dhun.flac', playable: 1 },
      { name: 'Placeholder katha.mkv', playable: 0 },
      { name: 'Placeholder old clip.avi', playable: 0 },
    ]);
  }, 180_000);
});
