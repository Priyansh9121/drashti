import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../shared/engine/state';
import type { SlideElement } from '../../shared/model';
import { openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { RateGate } from './link-server';
import { WantedMedia } from './wanted-media';

/* What each node copies, and in what order (made-up files and names only). */

const sha = (n: number) => String(n).repeat(64).slice(0, 64);

/** A media folder with picture 1 and its sharpened copy, and a folder in it that is a link to one outside. */
function mediaFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'drashti-wanted-media-'));
  const dir = join(root, 'Media');
  mkdirSync(join(dir, 'sharpened'), { recursive: true });
  mkdirSync(join(root, 'Elsewhere'));
  writeFileSync(join(dir, `${sha(1)}.png`), Buffer.alloc(100, 1));
  writeFileSync(join(dir, 'sharpened', `${sha(1)}-50.jpg`), Buffer.alloc(42, 2));
  writeFileSync(join(root, 'Elsewhere', 'secret.png'), Buffer.alloc(100, 3));
  symlinkSync(join(root, 'Elsewhere'), join(dir, 'linked'), 'junction');
  return dir;
}
const real = (path: string) => realpathSync.native(path);

function library() {
  const db = openDatabase(':memory:');
  const media = (id: string, kind: 'image' | 'video' | 'audio', n: number, extra = '') =>
    db
      .prepare(
        `INSERT INTO media (id, kind, name, path, sha256, bytes${extra ? ', playable' : ''})
         VALUES (?, ?, ?, ?, ?, ?${extra ? ', 0' : ''})`,
      )
      .run(
        id,
        kind,
        `Placeholder ${id}`,
        `${sha(n)}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`,
        sha(n),
        100 * n,
      );
  media('slide-pic', 'image', 1);
  media('live-item', 'video', 2);
  media('week-item', 'image', 3);
  media('prop-pic', 'image', 4);
  media('song', 'audio', 5);
  media('old', 'image', 6);
  media('cannot-play', 'video', 7, 'unplayable');
  const presentations = new PresentationRepo(db);
  const libraryId = presentations.ensureLibrary('Default');
  const picture: SlideElement = {
    id: 'e1',
    kind: 'image',
    frame: { x: 0, y: 0, width: 100, height: 100 },
    mediaId: 'slide-pic',
    fit: 'fit',
  };
  const presentationId = presentations.insert({
    libraryId,
    name: 'Placeholder',
    groups: [{ name: 'G', slides: [{ elements: [picture] }] }],
  });
  const playlist = (
    id: string,
    updated: string,
    items: { kind: string; presentation?: string; media?: string }[],
  ) => {
    db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run(id, id);
    items.forEach((it, i) =>
      db
        .prepare(
          'INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(`${id}-${i}`, id, i, it.kind, it.presentation ?? null, it.media ?? null, 'x'),
    );
    db.prepare('UPDATE playlists SET updated_at = ?, created_at = ? WHERE id = ?').run(updated, updated, id);
  };
  playlist('live', '2026-01-01T00:00:00.000Z', [
    { kind: 'presentation', presentation: presentationId },
    { kind: 'media', media: 'live-item' },
    { kind: 'media', media: 'song' },
  ]);
  playlist('this-week', '2026-10-04T00:00:00.000Z', [{ kind: 'media', media: 'week-item' }]);
  playlist('long-ago', '2026-08-01T00:00:00.000Z', [{ kind: 'media', media: 'old' }]);
  db.prepare("INSERT INTO props (id, name, definition) VALUES ('p', 'Placeholder logo', ?)").run(
    JSON.stringify({ elements: [{ kind: 'image', mediaId: 'prop-pic' }] }),
  );
  return { db, presentationId };
}

describe('what a node copies', () => {
  it('what is up, the live playlist, the week’s playlists, props; never sound or files that cannot play', () => {
    const { db } = library();
    const wanted = new WantedMedia(
      db,
      () => ['cannot-play'],
      () => Date.parse('2026-10-05T10:00:00Z'),
    );
    const state = initialEngineState();
    state.live.playlist = { playlistId: 'live', itemId: 'live-0' };
    state.layers.background = {
      kind: 'media',
      mediaId: 'week-item',
      media: 'image',
      fit: 'fill',
      loop: false,
      startedAt: 0,
    };
    const list = wanted.list(state, false);
    expect(list.map((w) => w.id)).toEqual(['week-item', 'slide-pic', 'live-item', 'prop-pic']);
    expect(list[0]).toEqual({ id: 'week-item', sha256: sha(3), bytes: 300, ext: 'png' });
    // "Get everything ready": the rest of the library's pictures and videos too.
    expect(
      wanted
        .list(state, true)
        .map((w) => w.id)
        .sort(),
    ).toEqual(['live-item', 'old', 'prop-pic', 'slide-pic', 'week-item'].sort());
    // Where a file is, for a node that asks: inside the media folder only, by its real path.
    const dir = mediaFolder();
    expect(wanted.source('slide-pic', dir)).toEqual({
      path: real(join(dir, `${sha(1)}.png`)),
      sha256: sha(1),
      bytes: 100,
      ext: 'png',
    });
    expect(wanted.source('song', dir)).toBeNull();
  });

  it('never a file through a link in the media folder that leads out of it (Sessions 31–36, SEC-10)', () => {
    const { db } = library();
    const wanted = new WantedMedia(
      db,
      () => [],
      () => Date.parse('2026-10-05T10:00:00Z'),
    );
    const dir = mediaFolder();
    db.prepare("UPDATE media SET path = 'linked/secret.png' WHERE id = 'slide-pic'").run();
    expect(wanted.source('slide-pic', dir)).toBeNull();
  });
});

describe('a deck’s slide (Session 54, C2)', () => {
  it('brings its steps’ clips, last frames and holds, and its own videos and posters, after its picture; never its sound', () => {
    const db = openDatabase(':memory:');
    const files = ['last-0', 'last-1', 'poster', 'clip-0', 'clip-1', 'hold-1', 'video'];
    files.forEach((id, n) =>
      db
        .prepare('INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES (?, ?, ?, ?, ?, 10)')
        .run(
          id,
          id.startsWith('clip') || id.startsWith('hold') || id === 'video' ? 'video' : 'image',
          id,
          `${sha(n + 1)}.${id.startsWith('clip') || id.startsWith('hold') || id === 'video' ? 'mp4' : 'png'}`,
          sha(n + 1),
        ),
    );
    db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES ('tone', 'audio', 'tone', 'tone.m4a', ?, 10)",
    ).run(sha(9));
    const presentations = new PresentationRepo(db);
    const presentationId = presentations.insert({
      libraryId: presentations.ensureLibrary('Default'),
      name: 'Placeholder deck',
      groups: [
        {
          name: '',
          slides: [
            {
              elements: [
                {
                  id: 'picture',
                  kind: 'image',
                  frame: { x: 0, y: 0, width: 1920, height: 1080 },
                  mediaId: 'last-1',
                  fit: 'fit',
                },
              ],
              deck: {
                steps: [
                  { clipId: 'clip-0', clipMs: 900, lastId: 'last-0' },
                  { clipId: 'clip-1', clipMs: 900, lastId: 'last-1', holdId: 'hold-1', holdMs: 2000 },
                ],
                media: [
                  {
                    kind: 'video',
                    mediaId: 'video',
                    box: { x: 0, y: 0, w: 1, h: 1 },
                    posterId: 'poster',
                    loop: false,
                    volume: 1,
                    start: { step: 1, offsetMs: 0 },
                  },
                  {
                    kind: 'audio',
                    mediaId: 'tone',
                    box: { x: 0, y: 0, w: 0.1, h: 0.1 },
                    loop: false,
                    volume: 1,
                    start: { step: 0, offsetMs: 0 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run('live', 'live');
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, label) VALUES ('i', 'live', 0, 'presentation', ?, 'x')",
    ).run(presentationId);
    const state = initialEngineState();
    state.live.playlist = { playlistId: 'live', itemId: 'i' };
    const ids = new WantedMedia(db).list(state, false).map((w) => w.id);
    expect(ids).toEqual(
      ['last-1', 'clip-0', 'last-0', 'clip-1', 'last-1', 'hold-1', 'video', 'poster'].filter(
        (id, i, all) => all.indexOf(id) === i,
      ),
    );
  });
});

describe('a picture’s sharpened copy (Session 26f)', () => {
  it('comes right after the picture once it is ready, and is served from where the copies are', () => {
    const { db } = library();
    const dir = mediaFolder();
    const copy = { id: 'slide-pic_s50', sha256: sha(9), bytes: 42, ext: 'jpg' };
    const wanted = new WantedMedia(
      db,
      () => [],
      () => Date.parse('2026-10-05T10:00:00Z'),
      {
        want: (mediaId) => (mediaId === 'slide-pic' ? copy : null),
        source: (copyId) =>
          copyId === copy.id
            ? { path: join(dir, 'sharpened', `${sha(1)}-50.jpg`), ...copy, id: undefined }
            : null,
      },
    );
    const state = initialEngineState();
    state.live.playlist = { playlistId: 'live', itemId: 'live-0' };
    expect(wanted.list(state, false).map((w) => w.id)).toEqual([
      'slide-pic',
      'slide-pic_s50',
      'live-item',
      'week-item',
      'prop-pic',
    ]);
    expect(wanted.source('slide-pic_s50', dir)).toMatchObject({
      path: real(join(dir, 'sharpened', `${sha(1)}-50.jpg`)),
      sha256: sha(9),
      bytes: 42,
      ext: 'jpg',
    });
    // A copy outside the media folder, or one that is not ready: none.
    expect(wanted.source('slide-pic_s55', dir)).toBeNull();
    expect(wanted.source('slide-pic_s50', '/elsewhere')).toBeNull();
  });
});

describe('a playlist opened on Main (Session 14)', () => {
  it('counts as this week’s once opened, without changing when it last changed', () => {
    const { db } = library();
    const now = Date.now();
    const wanted = new WantedMedia(
      db,
      () => [],
      () => now,
    );
    const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const longAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    db.prepare('UPDATE playlists SET updated_at = ?, created_at = ? WHERE id = ?').run(
      longAgo,
      longAgo,
      'long-ago',
    );
    const before = wanted.list(initialEngineState(), false).map((w) => w.id);
    expect(before).not.toContain('old');
    const repo = new PlaylistRepo(db);
    // Opened: it did not count before, so what nodes copy changes...
    expect(repo.markOpened('long-ago', since)).toBe(true);
    wanted.invalidate();
    expect(wanted.list(initialEngineState(), false).map((w) => w.id)).toContain('old');
    // ...opened again, it already counted.
    expect(repo.markOpened('long-ago', since)).toBe(false);
    const row = db.prepare('SELECT updated_at FROM playlists WHERE id = ?').get('long-ago') as {
      updated_at: string;
    };
    expect(row.updated_at).toBe(longAgo);
    // Folders and unknown ids are not playlists to open.
    expect(repo.markOpened('no-such-playlist', since)).toBe(false);
  });
});

describe('the copy rate', () => {
  it('lets a burst through, then makes copies wait in proportion to the rate', () => {
    const gate = new RateGate(1024 * 1024);
    expect(gate.take(100 * 1024)).toBe(0);
    // A quarter of a second's worth at once, then the debt is paid in time.
    const wait = gate.take(1024 * 1024);
    expect(wait).toBeGreaterThan(700);
    expect(wait).toBeLessThan(1200);
    gate.setRate(10 * 1024 * 1024);
    expect(gate.take(1)).toBeLessThan(wait);
  });
});

describe('a deck’s slides (Session 54, C2)', () => {
  it('copies their steps’ clips, last frames and holds, and their videos’ posters, with the presentation', () => {
    const { db, presentationId } = library();
    db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES ('deck-clip', 'video', 'c', ?, ?, 10)",
    ).run(`${sha(8)}.mp4`, sha(8));
    db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES ('deck-last', 'image', 'l', ?, ?, 10)",
    ).run(`${sha(9)}.png`, sha(9));
    // As C2's import keeps a deck's slide (its `deck` column, migration 49).
    db.prepare(
      `UPDATE slides SET deck = ? WHERE group_id IN (SELECT id FROM slide_groups WHERE presentation_id = ?)`,
    ).run(
      JSON.stringify({ steps: [{ clipId: 'deck-clip', clipMs: 1000, lastId: 'deck-last' }], media: [] }),
      presentationId,
    );
    const wanted = new WantedMedia(
      db,
      () => [],
      () => Date.parse('2026-10-05T10:00:00Z'),
    );
    const state = initialEngineState();
    state.live.playlist = { playlistId: 'live', itemId: 'live-0' };
    expect(wanted.list(state, false).map((w) => w.id)).toEqual([
      'slide-pic',
      'deck-clip',
      'deck-last',
      'live-item',
      'week-item',
      'prop-pic',
    ]);
  });
});
