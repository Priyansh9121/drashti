import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../shared/engine/state';
import type { SlideElement } from '../../shared/model';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { RateGate } from './link-server';
import { WantedMedia } from './wanted-media';

/* What each node copies, and in what order (made-up files and names only). */

const sha = (n: number) => String(n).repeat(64).slice(0, 64);

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
    // Where a file is, for a node that asks: inside the media folder only.
    expect(wanted.source('slide-pic', '/placeholder/Media')).toEqual({
      path: `/placeholder/Media/${sha(1)}.png`,
      sha256: sha(1),
      bytes: 100,
      ext: 'png',
    });
    expect(wanted.source('song', '/placeholder/Media')).toBeNull();
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
