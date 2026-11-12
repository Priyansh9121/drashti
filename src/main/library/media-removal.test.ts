import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { WallpaperRepo } from '../db/wallpapers';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import { MemoryPlaylistSource } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { MediaRemoval, sweepQuiet, TrimCleanup } from './media-removal';

it('trashes only an unused Trim copy with the bytes Drashti wrote', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-unused-trims-'));
  const db = openDatabase(':memory:');
  try {
    const mediaDir = join(root, 'Media');
    const trashDir = join(root, 'Trash');
    mkdirSync(mediaDir);
    mkdirSync(trashDir);
    const ids = ['unused', 'playlist', 'undo', 'slide', 'live', 'replaced', 'path-alias', 'z-late'];
    db.exec(
      "INSERT INTO media (id, kind, name, path) VALUES ('original', 'video', 'Original', 'original.mp4')",
    );
    writeFileSync(join(mediaDir, 'original.mp4'), 'Placeholder original.');
    for (const id of ids) {
      const path = `${id}.mp4`;
      const bytes = `Placeholder ${id}.`;
      const sha = createHash('sha256').update(bytes).digest('hex');
      db.prepare(
        "INSERT INTO media (id, kind, name, path, sha256, source_kind) VALUES (?, 'video', ?, ?, ?, 'drashti')",
      ).run(id, path, path, sha);
      db.prepare(
        "INSERT INTO trimmed_videos (media_id, original_id, start_ms, end_ms, source_markers) VALUES (?, 'original', 0, 1000, '{}')",
      ).run(id);
      writeFileSync(join(mediaDir, path), id === 'replaced' ? 'Placeholder replacement.' : bytes);
    }
    db.exec(`
      INSERT INTO playlists (id, name) VALUES ('p', 'Placeholder playlist'), ('other', 'Placeholder duplicate');
      INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES
        ('current', 'other', 0, 'media', 'playlist'), ('old', 'p', 0, 'media', 'undo');
      UPDATE playlist_items SET deleted_at = '2026-11-12T00:00:00Z' WHERE id = 'old';
      INSERT INTO libraries (id, name) VALUES ('library', 'Placeholder library');
      INSERT INTO presentations (id, library_id, name) VALUES ('d', 'library', 'Placeholder deck');
      INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', 'd', 'Placeholder group', 0);
      INSERT INTO slides (id, group_id, position) VALUES ('s', 'g', 0);
      INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES
        ('e', 's', 0, 'video', 0, 0, 10, 10, '{"mediaId":"slide","fit":"fit"}');
    `);
    db.prepare("INSERT INTO media (id, kind, name, path) VALUES ('alias', 'video', 'Alias', ?)").run(
      join(mediaDir, 'path-alias.mp4'),
    );
    const removal = new MediaRemoval(db, { onScreens: () => new Set(['live']) });
    const trash = vi.fn((file: string) => {
      renameSync(file, join(trashDir, 'unused.mp4'));
      // The operator can add a slide reference while the first move is in progress.
      db.prepare('UPDATE elements SET props = ? WHERE id = ?').run(
        JSON.stringify({ mediaId: 'slide', other: 'z-late' }),
        'e',
      );
      return Promise.resolve();
    });

    expect(await removal.trashUnusedTrims(mediaDir, trash, () => true, new AbortController().signal)).toBe(1);
    expect(trash).toHaveBeenCalledOnce();
    expect(existsSync(join(trashDir, 'unused.mp4'))).toBe(true);
    expect(existsSync(join(mediaDir, 'unused.mp4'))).toBe(false);
    expect(db.prepare("SELECT path, missing FROM media WHERE id = 'unused'").get()).toEqual({
      path: '',
      missing: 1,
    });
    for (const id of [...ids.filter((id) => id !== 'unused'), 'original'])
      expect(existsSync(join(mediaDir, `${id}.mp4`)), id).toBe(true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps unused-cut work off startup and pauses it while a show or stream is up', async () => {
  vi.useFakeTimers();
  try {
    let quiet = true;
    const sweep = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    );
    const cleanup = new TrimCleanup(() => quiet, sweep, vi.fn());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).not.toHaveBeenCalled();

    quiet = false;
    cleanup.open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).not.toHaveBeenCalled();

    quiet = true;
    cleanup.activityChanged();
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    const [active] = sweep.mock.calls[0] ?? [];
    quiet = false;
    cleanup.activityChanged();
    expect(active?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    quiet = true;
    cleanup.activityChanged();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    cleanup.close();
    expect(sweep.mock.calls[1]?.[0].aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

/*
 * The sweep never moves a cut that the show could put up again (review HIGH-1 of d487b875): Oops, Put it back and
 * Back bring back what was up earlier in this run, and a restart after a crash puts back the show saved last.
 */

/** Placeholder cuts of one original: `held` (no row uses it any more) and `newer` (its row's cut now), with files. */
function earlierCuts(ids: readonly string[] = ['held', 'newer']) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-held-trims-'));
  const db = openDatabase(':memory:');
  const mediaDir = join(root, 'Media');
  const trashDir = join(root, 'Trash');
  mkdirSync(mediaDir);
  mkdirSync(trashDir);
  db.exec("INSERT INTO media (id, kind, name, path) VALUES ('original', 'video', 'Original', 'original.mp4')");
  writeFileSync(join(mediaDir, 'original.mp4'), 'Placeholder original.');
  for (const id of ids) {
    const bytes = `Placeholder ${id} cut.`;
    db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256, source_kind) VALUES (?, 'video', ?, ?, ?, 'drashti')",
    ).run(id, `${id}.mp4`, `${id}.mp4`, createHash('sha256').update(bytes).digest('hex'));
    db.prepare(
      "INSERT INTO trimmed_videos (media_id, original_id, start_ms, end_ms, source_markers) VALUES (?, 'original', 0, 1000, '{}')",
    ).run(id);
    writeFileSync(join(mediaDir, `${id}.mp4`), bytes);
  }
  db.exec(`
    INSERT INTO playlists (id, name) VALUES ('p', 'Placeholder playlist');
    INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES ('cut-row', 'p', 0, 'media', 'newer');
  `);
  const trash = vi.fn((file: string) => {
    renameSync(file, join(trashDir, basename(file)));
    return Promise.resolve();
  });
  return {
    db,
    mediaDir,
    trash,
    exists: (id: string) => existsSync(join(mediaDir, `${id}.mp4`)),
    trashed: () => readdirSync(trashDir),
    close: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The show: the playlist row went up while it still played `held`; its newer cut was taken in after. */
function showOfHeldCut() {
  const source = makeSource();
  source.set('words', [textSlide('slide', 'Placeholder words')], []);
  const playlists = new MemoryPlaylistSource();
  const rows = (mediaId: string) => [
    { id: 'cut-row', kind: 'media' as const, mediaId, media: 'video' as const, label: 'Placeholder cut' },
    { id: 'words-row', kind: 'presentation' as const, presentationId: 'words', arrangementId: undefined },
  ];
  playlists.set('p', rows('held'));
  const engine = new ShowEngine(source, new RecordingTransport(), () => 1000, playlists);
  expect(engine.dispatch({ type: 'playItem', playlistId: 'p', itemId: 'cut-row' }).ok).toBe(true);
  expect(engine.current.layers.background).toMatchObject({ mediaId: 'held' });
  playlists.set('p', rows('newer'));
  return engine;
}

it.each([
  ['Put it back', { type: 'clearAll' }, { type: 'putBack' }],
  ['Oops', { type: 'clearLayer', layer: 'background' }, { type: 'oops' }],
] as const)('keeps a cut that %s could put up again', async (_name, off, back) => {
  const x = earlierCuts();
  try {
    const engine = showOfHeldCut();
    expect(engine.dispatch(off).ok).toBe(true);
    expect(engine.current.layers.background).toBeNull();
    expect(sweepQuiet(engine)).toBe(false);

    const removal = new MediaRemoval(x.db, { onScreens: () => new Set() });
    const quiet = () => sweepQuiet(engine);
    expect(await removal.trashUnusedTrims(x.mediaDir, x.trash, quiet, new AbortController().signal)).toBe(0);
    expect(x.trash).not.toHaveBeenCalled();
    expect(engine.dispatch(back).ok).toBe(true);
    expect(engine.current.layers.background).toMatchObject({ mediaId: 'held' });
    expect(x.exists('held')).toBe(true);
  } finally {
    x.close();
  }
});

it('waits until nothing earlier in the run can come back, then moves the cut no row uses', async () => {
  const x = earlierCuts();
  try {
    const engine = showOfHeldCut();
    expect(engine.dispatch({ type: 'next' }).ok).toBe(true);
    expect(sweepQuiet(engine)).toBe(false);
    // Oops twice takes the run back to before the cut went up: nothing is left for Oops, Put it back or Back.
    expect(engine.dispatch({ type: 'oops' }).ok).toBe(true);
    expect(engine.dispatch({ type: 'oops' }).ok).toBe(true);
    expect(engine.current.layers.background).toBeNull();
    expect(engine.remembersEarlier).toBe(false);
    expect(sweepQuiet(engine)).toBe(true);

    const removal = new MediaRemoval(x.db, { onScreens: () => new Set() });
    const quiet = () => sweepQuiet(engine);
    expect(await removal.trashUnusedTrims(x.mediaDir, x.trash, quiet, new AbortController().signal)).toBe(1);
    expect(x.trashed()).toEqual(['held.mp4']);
    expect(x.exists('newer')).toBe(true);
  } finally {
    x.close();
  }
});

it('keeps a cut that the show saved last would put back after a crash', async () => {
  const x = earlierCuts();
  try {
    const removal = new MediaRemoval(x.db, { onScreens: () => new Set(), putBack: () => new Set(['held']) });
    expect(await removal.trashUnusedTrims(x.mediaDir, x.trash, () => true, new AbortController().signal)).toBe(
      0,
    );
    expect(x.trash).not.toHaveBeenCalled();
    expect(x.exists('held')).toBe(true);
  } finally {
    x.close();
  }
});

/** Count the whole-library JSON passes (one `json_tree` statement run over every document). */
function countJsonPasses(db: Db): () => number {
  let passes = 0;
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(((source: string) => {
    const statement = prepare(source);
    if (!source.includes('json_tree')) return statement;
    return new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (key === 'all') passes++;
          return Reflect.apply(value, target, args) as unknown;
        };
      },
    });
  }) as typeof db.prepare);
  return () => passes;
}

it('reads the library’s JSON at most twice in a sweep, though the library changes all the while', async () => {
  const x = earlierCuts(['a-unused', 'b-unused', 'c-unused', 'd-on-slide', 'newer']);
  try {
    x.db.exec(`
      INSERT INTO libraries (id, name) VALUES ('library', 'Placeholder library');
      INSERT INTO presentations (id, library_id, name) VALUES ('d', 'library', 'Placeholder deck');
      INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', 'd', 'Placeholder group', 0);
      INSERT INTO slides (id, group_id, position) VALUES ('s', 'g', 0);
      INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES
        ('e', 's', 0, 'video', 0, 0, 10, 10, '{"mediaId":"d-on-slide","fit":"fit"}');
    `);
    const passes = countJsonPasses(x.db);
    // Bookkeeping (a phone seen, a length learned) writes to the library whenever the sweep looks up.
    const seen = x.db.prepare("UPDATE media SET bytes = coalesce(bytes, 0) + 1 WHERE id = 'original'");
    const quiet = () => seen.run().changes === 1;
    const removal = new MediaRemoval(x.db, { onScreens: () => new Set() });
    const gone = await removal.trashUnusedTrims(x.mediaDir, x.trash, quiet, new AbortController().signal);
    expect(passes()).toBeLessThanOrEqual(2);
    expect(x.trashed()).toHaveLength(gone);
    expect(x.trashed()).not.toContain('d-on-slide.mp4');
    expect(x.exists('d-on-slide')).toBe(true);
    expect(x.exists('newer')).toBe(true);
  } finally {
    vi.restoreAllMocks();
    x.close();
  }
});

/* Deleting media with Undo (Session 26a): a made-up library that uses one picture everywhere. */

function library(over: { live?: string[] } = {}) {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO media (id, kind, name, path, sha256) VALUES
      ('pic', 'image', 'Placeholder darshan.png', 'aa/pic.png', 'aa'),
      ('snd', 'audio', 'Placeholder dhun.mp3', 'bb/snd.mp3', 'bb'),
      ('other', 'image', 'Other.png', 'cc/other.png', 'cc');
    INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
    INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'Placeholder Katha'),
      ('p2', 'lib', 'Placeholder Background'), ('p3', 'lib', 'Placeholder Removed');
    UPDATE presentations SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id = 'p3';
    INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g1', 'p1', 'G', 0), ('g2', 'p2', 'G', 0),
      ('g3', 'p3', 'G', 0);
    INSERT INTO slides (id, group_id, position) VALUES ('s1', 'g1', 0), ('s2', 'g2', 0), ('s3', 'g3', 0);
    INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES
      ('e1', 's1', 0, 'image', 0, 0, 10, 10, '{"mediaId":"pic","fit":"fill"}'),
      ('e3', 's3', 0, 'image', 0, 0, 10, 10, '{"mediaId":"pic","fit":"fill"}');
    INSERT INTO slide_cues (id, slide_id, position, kind, media_id) VALUES ('c2', 's2', 0, 'background', 'pic');
    INSERT INTO playlists (id, name) VALUES ('pl1', 'Sunday'), ('pl2', 'Youth');
    INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES
      ('i1', 'pl1', 0, 'media', 'pic'), ('i2', 'pl2', 0, 'media', 'pic'), ('i3', 'pl2', 1, 'media', 'other');
    INSERT INTO audio_playlists (id, name) VALUES ('mu', 'Before sabha');
    INSERT INTO audio_playlist_tracks (id, playlist_id, media_id, position) VALUES ('t1', 'mu', 'snd', 0);
    INSERT INTO props (id, name, definition) VALUES ('pr', 'Placeholder prop',
      '{"elements":[{"id":"x","kind":"image","mediaId":"pic"}]}');
    INSERT INTO themes (id, name, definition) VALUES ('th', 'Placeholder theme',
      '{"background":{"kind":"media","mediaId":"pic","media":"image","fit":"fill","loop":false}}');
    INSERT INTO macros (id, name, actions) VALUES ('ma', 'Placeholder macro',
      '[{"kind":"background","mediaId":"pic"}]');
  `);
  const removal = new MediaRemoval(db, {
    onScreens: () => new Set(over.live ?? []),
  });
  return {
    db,
    removal,
    media: new MediaRepo(db),
    playlists: new PlaylistRepo(db),
    music: new AudioPlaylistRepo(db),
  };
}

const itemIds = (playlists: PlaylistRepo, id: string) => playlists.itemsOf(id).map((i) => i.id);

describe('deleting media from the library', () => {
  it('says where it is used: slides, playlists, music, themes, and on the screens', () => {
    const { removal } = library({ live: ['pic'] });
    const usage = removal.usage(['pic']);
    // A removed presentation does not count.
    expect(usage.presentations).toEqual({ names: ['Placeholder Background', 'Placeholder Katha'], count: 2 });
    expect(usage.playlists).toEqual({ names: ['Sunday', 'Youth'], count: 2 });
    expect(usage.music.count).toBe(0);
    expect(usage.themes.names).toEqual(['Placeholder theme']);
    // A library's macros (Session 44), props and idle rotation (Session 55) are kept as they were, and no longer
    // counted: they are gone from the window.
    expect(usage).not.toHaveProperty('macros');
    expect(usage).not.toHaveProperty('props');
    expect(usage).not.toHaveProperty('idle');
    expect(usage.live).toBe(true);
    expect(removal.usage(['snd']).music).toEqual({ names: ['Before sabha'], count: 1 });
    expect(removal.usage(['other']).presentations.count).toBe(0);
  });

  it('says the wallpapers it is in (Session 55, Part 6), and nothing of them when it is in none', () => {
    const { db, removal } = library();
    const walls = new WallpaperRepo(db);
    walls.create('Placeholder evening', ['pic']);
    const gone = walls.create('Placeholder deleted', ['pic']);
    walls.remove(gone);
    expect(removal.usage(['pic']).wallpapers).toEqual({ names: ['Placeholder evening'], count: 1 });
    expect(removal.usage(['snd'])).not.toHaveProperty('wallpapers');
  });

  it('takes it out of the media list, playlists and music; Undo puts back just what it took', () => {
    const { db, removal, media, playlists, music } = library();
    // Taken out of a playlist by hand before: Undo of the deletion must not bring that back.
    db.prepare("UPDATE playlist_items SET deleted_at = '2026-10-02T00:00:00.000Z' WHERE id = 'i2'").run();
    expect(removal.remove(['pic', 'snd', 'nothing'])).toEqual(['pic', 'snd']);
    expect(removal.remove(['pic'])).toEqual([]);
    expect(media.list().map((m) => m.id)).toEqual(['other']);
    expect(itemIds(playlists, 'pl1')).toEqual([]);
    expect(itemIds(playlists, 'pl2')).toEqual(['i3']);
    expect(music.list()[0]?.tracks).toEqual([]);
    // Everything else treats it as a missing file.
    expect(media.kindAndName('pic')).toBeNull();
    expect(media.kindAndFile('pic')?.missing).toBe(true);
    expect(media.file('pic')).toMatchObject({ path: 'aa/pic.png', deleted: true });
    // It cannot be added anywhere while deleted.
    expect(playlists.addItems('pl1', null, [{ kind: 'media', mediaId: 'pic' }])).toEqual([]);
    expect(music.addTracks('mu', ['snd'], null)).toBe(0);

    expect(removal.restore(['pic', 'snd'])).toEqual(['pic', 'snd']);
    expect(
      media
        .list()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['other', 'pic', 'snd']);
    expect(itemIds(playlists, 'pl1')).toEqual(['i1']);
    expect(itemIds(playlists, 'pl2')).toEqual(['i3']);
    expect(music.list()[0]?.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(media.file('pic')?.deleted).toBe(false);
  });

  it('removes the file only at the next start, never one on the screens; the row stays a missing file', async () => {
    const { db, removal, media } = library();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-media-removal-'));
    for (const rel of [
      'aa/pic.png',
      'stills/aa.jpg',
      'sharpened/aa-50.jpg',
      'cc/other.png',
      'sharpened/cc-50.png',
    ]) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), 'placeholder');
    }
    removal.remove(['pic', 'other']);
    // 'other' is up on the screens again after a restart: it stays until the next start.
    expect(await removal.purge(dir, new Set(['other']))).toBe(1);
    expect(existsSync(join(dir, 'aa/pic.png'))).toBe(false);
    expect(existsSync(join(dir, 'stills/aa.jpg'))).toBe(false);
    // Its sharpened copy goes with it (Session 26f).
    expect(existsSync(join(dir, 'sharpened/aa-50.jpg'))).toBe(false);
    expect(existsSync(join(dir, 'cc/other.png'))).toBe(true);
    expect(existsSync(join(dir, 'sharpened/cc-50.png'))).toBe(true);
    expect(media.file('pic')).toMatchObject({ path: '', missing: true, deleted: true });
    // Slides still point at it, as at any missing file; it can no longer be undone.
    expect(db.prepare("SELECT count(*) AS n FROM elements WHERE id = 'e1'").get()).toEqual({ n: 1 });
    expect(removal.restore(['pic'])).toEqual([]);
    expect(removal.restore(['other'])).toEqual(['other']);
  });

  it('never removes a file of the owner’s outside Drashti’s data folder (Session 55, Part 14), whatever its row says', async () => {
    const { db, removal } = library();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-media-removal-'));
    const owner = mkdtempSync(join(tmpdir(), 'drashti-media-removal-owner-'));
    const kept = join(owner, 'Placeholder owner clip.mp4');
    const climbing = join(owner, 'Placeholder climbing.png');
    writeFileSync(kept, 'placeholder');
    writeFileSync(climbing, 'placeholder');
    // A row pointing at the owner's own file by its full path, and one whose path climbs out of the media folder.
    const out = join('..', owner.split(/[\\/]/u).at(-1) ?? '', 'Placeholder climbing.png');
    db.prepare(
      `INSERT INTO media (id, kind, name, path, sha256) VALUES ('own', 'video', 'Placeholder own.mp4', ?, 'dd'),
         ('climb', 'image', 'Placeholder climbing.png', ?, 'ee')`,
    ).run(kept, out);
    expect(removal.remove(['own', 'climb'])).toEqual(['own', 'climb']);
    expect(await removal.purge(dir, new Set())).toBe(0);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(climbing)).toBe(true);
  });
});
