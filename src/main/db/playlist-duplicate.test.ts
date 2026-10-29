import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';

/*
 * Duplicate a playlist (Session 55, Part 4, the owner's idea P): from its menu, as "<name> copy", right after it in its
 * folder, with its rows in their order (headers, presentations with their own order, media, slots, timer cues), its
 * kind and settings kept (a Repeat Slides playlist goes round the same). The original is left as it was. Placeholder
 * names only.
 */

let db: Db;
let playlists: PlaylistRepo;
let hymn: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  playlists = new PlaylistRepo(db);
  const presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Placeholder library');
  hymn = presentations.insert({
    libraryId: lib,
    name: 'Placeholder Hymn',
    groups: [
      { name: 'Verse', slides: [{ elements: [] }] },
      { name: 'Chorus', slides: [{ elements: [] }] },
    ],
    arrangements: [{ name: 'Usual', groups: [0, 1, 0] }],
  });
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('loop', 'video', 'Placeholder loop.mp4', 'ab/x.mp4')",
  ).run();
});

const rows = (id: string) =>
  playlists
    .itemsOf(id)
    .map((i) =>
      i.kind === 'presentation'
        ? `presentation ${i.label} ${i.order.mode}`
        : i.kind === 'placeholder'
          ? `slot ${i.label} ${String(i.category)}`
          : `${i.kind} ${i.label}`,
    );

describe('Duplicate a playlist', () => {
  it('makes "<name> copy" right after it, with its rows in their order and their settings, the original as it was', () => {
    const folder = playlists.create('Placeholder folder', null, true) ?? '';
    const first = playlists.create('Placeholder Sunday', folder, false) ?? '';
    const after = playlists.create('Placeholder later', folder, false) ?? '';
    const [, item] = playlists.addItems(first, null, [
      { kind: 'header', label: 'Placeholder part' },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'media', mediaId: 'loop' },
    ]);
    const arrangement = (
      db.prepare('SELECT id FROM arrangements WHERE presentation_id = ?').get(hymn) as { id: string }
    ).id;
    expect(playlists.setItemOrder(item ?? '', { mode: 'arrangement', arrangementId: arrangement })).toBe(
      true,
    );
    playlists.addSlot(first, null, 'Placeholder slot', 'Placeholder category');
    const before = rows(first);

    const copy = playlists.duplicate(first);
    expect(copy).not.toBeNull();
    const tree = playlists.tree();
    expect(tree.map((n) => n.name)).toEqual([
      'Placeholder folder',
      'Placeholder Sunday',
      'Placeholder Sunday copy',
      'Placeholder later',
    ]);
    expect(tree.find((n) => n.id === copy)?.parentId).toBe(folder);
    expect(rows(copy ?? '')).toEqual(before);
    expect(playlists.itemsOf(copy ?? '').find((i) => i.kind === 'presentation')).toMatchObject({
      order: { mode: 'arrangement', arrangementId: arrangement },
    });
    // New rows of its own: the original's are as they were.
    expect(playlists.itemsOf(copy ?? '').map((i) => i.id)).not.toContain(item);
    expect(rows(first)).toEqual(before);
    expect(tree.find((n) => n.id === after)?.name).toBe('Placeholder later');
  });

  it('keeps a Repeat Slides playlist going round the same; a folder, a template or one gone is not duplicated', () => {
    const repeat = playlists.createRepeat('Placeholder round', null) ?? '';
    const copy = playlists.duplicate(repeat);
    expect(playlists.tree().find((n) => n.id === copy)).toMatchObject({
      name: 'Placeholder round copy',
      kind: 'repeat',
    });
    expect(playlists.repeatPlaylist(copy ?? '')?.settings).toEqual(
      playlists.repeatPlaylist(repeat)?.settings,
    );
    expect(playlists.duplicate(playlists.create('Placeholder folder', null, true) ?? '')).toBeNull();
    expect(playlists.duplicate('missing')).toBeNull();
  });
});
