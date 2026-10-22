import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import { readContent } from '../db/content';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from '../import/media-store';
import { ConvertService } from './convert-service';
import { parseFfmpegInfo } from './plan';
import { copyFinder } from './relink';

/*
 * A converted original, added again anywhere (Session 51): to a playlist (by hand from Media, or with a
 * template), to a slide (its picture or video, its background or sound cue, a kirtan's recording), to an audio
 * playlist, or into Media as the same file imported again. It lands on its copy, as everything that used it was
 * moved there when it was converted; since Session 9 it landed on the original, which cannot play. After the
 * conversion's Undo, or with its copy deleted from the library, the original is used as before.
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** A library with an AVI and an AIFF converted (an MP4 and an M4A), and somewhere to add each. */
function library() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO media (id, kind, name, path, playable, format) VALUES
      ('avi', 'video', 'Placeholder katha.avi', 'aa/avi.avi', 0, 'MPEG-4 Part 2 video (AVI)'),
      ('mp4', 'video', 'Placeholder katha.mp4', 'bb/mp4.mp4', 1, 'H.264 video (MP4), converted by Drashti'),
      ('aiff', 'audio', 'Placeholder bell.aiff', 'cc/aiff.aiff', 0, 'AIFF sound file'),
      ('m4a', 'audio', 'Placeholder bell.m4a', 'dd/m4a.m4a', 1, 'AAC sound file (M4A), converted by Drashti'),
      ('png', 'image', 'Placeholder darshan.png', 'ee/png.png', 1, 'PNG picture');
    UPDATE media SET converted_from = 'avi' WHERE id = 'mp4';
    UPDATE media SET converted_from = 'aiff' WHERE id = 'm4a';
    INSERT INTO media_conversions (id, original_id, converted_id) VALUES ('cv-avi', 'avi', 'mp4'), ('cv-aiff', 'aiff', 'm4a');
    INSERT INTO playlists (id, name) VALUES ('pl', 'Placeholder list');
    INSERT INTO audio_playlists (id, name) VALUES ('ap', 'Placeholder music');
  `);
  return db;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

const undo = (db: ReturnType<typeof library>, id: string) =>
  db
    .prepare("UPDATE media_conversions SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(id);

describe('a converted original, added again anywhere (Session 51)', () => {
  it('stands for its copy while the conversion stands and the copy is in the library', () => {
    const db = library();
    const copy = copyFinder(db);
    expect(['avi', 'aiff', 'mp4', 'png', 'unknown'].map(copy)).toEqual([
      'mp4',
      'm4a',
      'mp4',
      'png',
      'unknown',
    ]);
    // Undone: the original again.
    undo(db, 'cv-avi');
    expect(copy('avi')).toBe('avi');
    // The copy deleted from the library (Session 26a): the original, which is converted again when asked.
    db.prepare("UPDATE media SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'm4a'").run();
    expect(copy('aiff')).toBe('aiff');
  });

  it('a playlist: added by hand from Media, or copied with a template, uses the copy', () => {
    const db = library();
    const playlists = new PlaylistRepo(db);
    const [item] = playlists.addItems('pl', null, [{ kind: 'media', mediaId: 'avi' }]);
    const row = (id: string | undefined) =>
      db.prepare('SELECT media_id, label FROM playlist_items WHERE id = ?').get(id ?? '');
    expect(row(item)).toEqual({ media_id: 'mp4', label: 'Placeholder katha.mp4' });
    // An item on the original from before (added since Session 9): a template made from the playlist, and a
    // playlist made from that template, use the copy.
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, media_id, label) VALUES ('old', 'pl', 1, 'media', 'avi', 'Placeholder katha.avi')",
    ).run();
    const template = playlists.saveAsTemplate('pl', 'Placeholder template', []);
    const fromTemplate = playlists.newFromTemplate(template ?? '', 'Placeholder sabha', null);
    for (const id of [template, fromTemplate])
      expect(
        db
          .prepare('SELECT media_id FROM playlist_items WHERE playlist_id = ? ORDER BY position')
          .all(id ?? '')
          .map((r) => (r as { media_id: string }).media_id),
      ).toEqual(['mp4', 'mp4']);
    // Undone: added again, it is the original.
    undo(db, 'cv-avi');
    const [again] = playlists.addItems('pl', null, [{ kind: 'media', mediaId: 'avi' }]);
    expect(row(again)).toEqual({ media_id: 'avi', label: 'Placeholder katha.avi' });
  });

  it('an audio playlist: the copy is the track', () => {
    const db = library();
    expect(new AudioPlaylistRepo(db).addTracks('ap', ['aiff'], null)).toBe(1);
    expect(db.prepare('SELECT media_id FROM audio_playlist_tracks').all()).toEqual([{ media_id: 'm4a' }]);
  });

  it('a slide: its picture or video, its background and sound cues and a kirtan’s recording use the copies', () => {
    const db = library();
    const presentations = new PresentationRepo(db);
    const id = presentations.insert({
      libraryId: presentations.ensureLibrary('Default'),
      name: 'Placeholder kirtan',
      groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
      kirtan: {},
    });
    const before = readContent(db, id);
    if (!before) throw new Error('no presentation');
    const slide = before.slides[0]?.id ?? '';
    // The slide editor's save (or Undo putting back what it saved before), with the originals dragged in from Media.
    presentations.setContent({
      ...before,
      elements: [
        {
          id: 'e-video',
          slide_id: slide,
          position: 0,
          kind: 'video',
          x: 0,
          y: 0,
          width: 960,
          height: 540,
          rotation: 0,
          props: JSON.stringify({ mediaId: 'avi', fit: 'fill' }),
        },
        {
          id: 'e-picture',
          slide_id: slide,
          position: 1,
          kind: 'image',
          x: 0,
          y: 0,
          width: 960,
          height: 540,
          rotation: 0,
          props: JSON.stringify({ mediaId: 'png', fit: 'fit' }),
        },
      ],
      cues: [
        {
          id: 'c-bg',
          slide_id: slide,
          position: 0,
          kind: 'background',
          label: 'Placeholder',
          media_id: 'avi',
          props: '{}',
        },
        {
          id: 'c-sound',
          slide_id: slide,
          position: 1,
          kind: 'audio',
          label: 'Placeholder',
          media_id: 'aiff',
          props: '{}',
        },
      ],
      kirtan: {
        row: { category: null, kavi: null, raag: null, occasions: '[]', audio_media_id: 'aiff' },
      },
    });
    const after = readContent(db, id);
    expect(after?.elements.map((e) => [e.id, JSON.parse(e.props) as unknown])).toEqual([
      ['e-video', { mediaId: 'mp4', fit: 'fill' }],
      ['e-picture', { mediaId: 'png', fit: 'fit' }],
    ]);
    expect(after?.cues.map((c) => [c.id, c.media_id])).toEqual([
      ['c-bg', 'mp4'],
      ['c-sound', 'm4a'],
    ]);
    expect(after?.kirtan?.row.audio_media_id).toBe('m4a');
  });

  it('its copy deleted from the library: Media offers Convert again, and converting makes a copy again', () => {
    const db = library();
    db.prepare("UPDATE media SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'mp4'").run();
    const avi = new MediaRepo(db).list().find((m) => m.id === 'avi');
    expect(avi).toMatchObject({ convertedTo: null, unplayable: 'MPEG-4 Part 2 video (AVI)' });
    let jobs: ConversionJob[] = [];
    const service = new ConvertService({
      db,
      mediaDir: join(tmpdir(), 'drashti-added-again-nowhere'),
      ffmpegPath: () => 'placeholder-ffmpeg',
      busy: () => 'Waits while the stream is on air or recording, then carries on by itself.',
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
    });
    try {
      // Not "converted already" (its uses moved to a copy that is gone): a new conversion, waiting its turn.
      expect(service.convert(['avi'])).toMatchObject({ ok: true });
      expect(jobs.map((j) => [j.mediaId, j.state])).toEqual([['avi', 'waiting']]);
      // The other, whose copy is there, is converted already.
      expect(service.convert(['aiff'])).toMatchObject({ ok: false });
    } finally {
      service.close();
    }
  });

  it('what was added on an original before (since Session 9) moves to its copy once at the start, off air, kept for Undo (Session 51 review)', async () => {
    const db = library();
    // Added by hand from Media before Session 51: on the originals. And one on an original whose conversion was
    // undone, which stays.
    db.exec(`
      INSERT INTO playlist_items (id, playlist_id, position, kind, media_id, label)
        VALUES ('i-left', 'pl', 0, 'media', 'avi', 'Placeholder katha.avi');
      INSERT INTO audio_playlist_tracks (id, playlist_id, media_id, position) VALUES ('t-left', 'ap', 'aiff', 0);
      INSERT INTO media (id, kind, name, path, playable) VALUES
        ('wmv', 'video', 'Placeholder old.wmv', 'ff/wmv.wmv', 0), ('wmv-copy', 'video', 'Placeholder old.mp4', 'gg/wmv.mp4', 1);
      INSERT INTO media_conversions (id, original_id, converted_id, undone_at)
        VALUES ('cv-wmv', 'wmv', 'wmv-copy', '2026-10-20T10:00:00.000Z');
      INSERT INTO playlist_items (id, playlist_id, position, kind, media_id, label)
        VALUES ('i-undone', 'pl', 1, 'media', 'wmv', 'Placeholder old.wmv');
    `);
    const on = (table: 'playlist_items' | 'audio_playlist_tracks', id: string) =>
      (db.prepare(`SELECT media_id FROM ${table} WHERE id = ?`).get(id) as { media_id: string }).media_id;
    let busy: string | null = 'Waits while the stream is on air or recording, then carries on by itself.';
    const service = new ConvertService({
      db,
      mediaDir: join(tmpdir(), 'drashti-added-again-nowhere'),
      ffmpegPath: () => 'placeholder-ffmpeg',
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: () => undefined,
      libraryChanged: () => undefined,
      log: () => undefined,
      limits: { afterStartMs: 0 },
    });
    try {
      // The start (the stream's own start known): on air, nothing moves.
      service.resumeWaiting();
      await sleep(1500);
      expect(on('playlist_items', 'i-left')).toBe('avi');
      busy = null;
      await until(() => on('playlist_items', 'i-left') === 'mp4');
      expect(on('audio_playlist_tracks', 't-left')).toBe('m4a');
      expect(on('playlist_items', 'i-undone')).toBe('wmv');
      // Kept with the conversion: its Undo moves them back.
      const moved = db.prepare("SELECT moved FROM media_conversions WHERE id = 'cv-avi'").get() as {
        moved: string;
      };
      expect((JSON.parse(moved.moved) as { items: string[] }).items).toEqual(['i-left']);
    } finally {
      service.close();
    }
  });

  it('the same file imported again (Media, a drop, the drop folder): its copy, never converted again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-added-again-'));
    const mediaDir = join(dir, 'Media');
    const source = join(dir, 'source');
    mkdirSync(mediaDir);
    mkdirSync(source);
    const db = openDatabase(':memory:');
    // FFmpeg reads it as an AVI Drashti cannot play: imported the first time, it is to be converted.
    const store = new MediaStore(db, {
      dir: mediaDir,
      freeBytes: () => 100 * 1024 ** 3,
      readInfo: () =>
        Promise.resolve(
          parseFfmpegInfo(
            [
              "Input #0, avi, from '/x.avi':",
              '  Duration: 00:00:01.00, start: 0.000000, bitrate: 117 kb/s',
              '  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 64x48, 10 fps, 10 tbr, 10 tbn',
            ].join('\n'),
          ),
        ),
    });
    const file = join(source, 'Placeholder katha.avi');
    writeFileSync(file, 'placeholder avi bytes');
    const first = await store.importFile(file, { kind: 'media', path: file });
    if (first.outcome === 'failed') throw new Error(first.issue.message);
    expect(first).toMatchObject({ outcome: 'imported', convert: true });
    db.prepare(
      `INSERT INTO media (id, kind, name, path, playable, format, converted_from)
       VALUES ('mp4', 'video', 'Placeholder katha.mp4', 'bb/mp4.mp4', 1, 'H.264 video (MP4), converted by Drashti', ?)`,
    ).run(first.mediaId);
    db.prepare("INSERT INTO media_conversions (id, original_id, converted_id) VALUES ('cv', ?, 'mp4')").run(
      first.mediaId,
    );
    const again = await store.importFile(file, { kind: 'media', path: file });
    expect(again).toMatchObject({
      outcome: 'skipped',
      mediaId: 'mp4',
      name: 'Placeholder katha.mp4',
      probe: { playable: true, format: 'H.264 video (MP4), converted by Drashti', kind: 'video' },
    });
    expect(again.outcome !== 'failed' && again.convert).toBeFalsy();
    // A missing file found again with the same bytes (Relink): merged into the copy.
    const missing = store.addMissing('/old/place/Placeholder katha.avi', 'video', {
      kind: 'pp7',
      path: '/x.pro',
    });
    expect(await store.fillMissing(missing, file)).toMatchObject({ outcome: 'skipped', mediaId: 'mp4' });
    // Undone: the original again, to be converted as before.
    db.prepare("UPDATE media_conversions SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
    expect(await store.importFile(file, { kind: 'media', path: file })).toMatchObject({
      outcome: 'skipped',
      mediaId: first.mediaId,
      convert: true,
    });
  });
});
