import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { PresentationRepo } from './presentations';

/*
 * A video input as a playlist item (Session 51, migration 47): an item may name one of a computer's video inputs
 * by its name, every item kept as it was (rowid, order, timers, removed or not), the playlists' indexes and the
 * triggers that tell nodes a playlist changed made again, and no playlist's time changed by the upgrade.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-input-items-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const rows = (db: Db) =>
  db
    .prepare(
      `SELECT rowid, id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label, color, hint,
              order_mode, deleted_at, category, passage, timers
         FROM playlist_items ORDER BY rowid`,
    )
    .all();
const schemaOf = (db: Db, type: 'index' | 'trigger') =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = 'playlist_items' ORDER BY name",
    )
    .all(type);
const stamps = (db: Db) => db.prepare('SELECT id, updated_at FROM playlists ORDER BY id').all();

/** A version 46 library with a playlist of every kind of item, one removed and one with a timer cue. */
function v46Library(file: string): Db {
  const db = openDatabase(
    file,
    MIGRATIONS.filter((m) => m.version <= 46),
  );
  expect(schemaVersion(db)).toBe(46);
  const repo = new PresentationRepo(db);
  const hymn = repo.insert({
    libraryId: repo.ensureLibrary('Default'),
    name: 'Placeholder hymn',
    groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
    arrangements: [{ name: 'Usual', groups: [0, 0] }],
  });
  const arrangement = (db.prepare('SELECT id FROM arrangements LIMIT 1').get() as { id: string }).id;
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('clip', 'video', 'Placeholder clip.mp4', 'ab/clip.mp4')",
  ).run();
  db.prepare(
    "INSERT INTO playlists (id, name, updated_at) VALUES ('sunday', 'Placeholder Sunday', '2026-01-02T03:04:05.000Z')",
  ).run();
  const insert = db.prepare(
    `INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, arrangement_id, media_id, label,
                                 color, hint, order_mode, deleted_at, category, passage, timers)
     VALUES (@id, 'sunday', @position, @kind, @presentation, @arrangement, @media, @label, @color, @hint, @order,
             @deleted, @category, @passage, @timers)`,
  );
  const none = {
    presentation: null,
    arrangement: null,
    media: null,
    color: null,
    hint: null,
    order: 'presentation',
    deleted: null,
    category: null,
    passage: null,
    timers: null,
  };
  insert.run({ ...none, id: 'header', position: 0, kind: 'header', label: 'Opening', color: '#3e63dd' });
  insert.run({
    ...none,
    id: 'hymn',
    position: 1,
    kind: 'presentation',
    presentation: hymn,
    arrangement,
    order: 'arrangement',
    label: 'Placeholder hymn',
    timers: '[{"timerId":"t1","action":"start"}]',
  });
  insert.run({
    ...none,
    id: 'clip',
    position: 2,
    kind: 'media',
    media: 'clip',
    label: 'Placeholder clip.mp4',
  });
  insert.run({ ...none, id: 'slot', position: 3, kind: 'placeholder', label: 'Kirtan', category: 'Dhun' });
  insert.run({
    ...none,
    id: 'passage',
    position: 4,
    kind: 'shastra',
    label: 'Placeholder 1.1',
    passage: '{"text":"placeholder","section":[],"from":1,"to":1}',
  });
  insert.run({
    ...none,
    id: 'gone',
    position: 5,
    kind: 'header',
    label: 'Removed',
    deleted: '2026-01-02T03:04:05.000Z',
  });
  // The items written above touched the playlist: its time as a node last saw it.
  db.prepare("UPDATE playlists SET updated_at = '2026-01-02T03:04:05.000Z' WHERE id = 'sunday'").run();
  return db;
}

describe('a video input as a playlist item in the library', () => {
  it('migration 47: an item may name a video input, and every item stays exactly as it was', () => {
    const file = join(dir, 'library.sqlite');
    const v46 = v46Library(file);
    const before = rows(v46);
    const indexes = schemaOf(v46, 'index');
    const triggers = schemaOf(v46, 'trigger');
    expect(indexes.map((i) => (i as { name: string }).name)).toEqual([
      'playlist_items_by_playlist',
      'playlist_items_removed',
      // Its id's own index, which SQLite keeps under the table's name.
      'sqlite_autoindex_playlist_items_1',
    ]);
    expect(triggers).toHaveLength(3);
    const times = stamps(v46);
    // Before: no item could be an input.
    expect(() =>
      v46
        .prepare(
          "INSERT INTO playlist_items (id, playlist_id, position, kind, label) VALUES ('early', 'sunday', 9, 'input', 'Input 1')",
        )
        .run(),
    ).toThrow();
    v46.close();

    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(schemaVersion(db)).toBeGreaterThanOrEqual(47);
    // Every item as it was, rowid and order too; none names an input.
    expect(rows(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlist_items WHERE input_name IS NOT NULL').get()).toEqual(
      {
        n: 0,
      },
    );
    expect(schemaOf(db, 'index')).toEqual(indexes);
    // The triggers that tell nodes a playlist changed, made again as they were.
    expect(schemaOf(db, 'trigger')).toEqual(triggers);
    // The upgrade itself changed no playlist's time (nodes would copy every playlist's media again).
    expect(stamps(db)).toEqual(times);

    // An input item: named, and nothing else.
    const add = (id: string, kind: string, input: string | null, media: string | null = null) =>
      db
        .prepare(
          'INSERT INTO playlist_items (id, playlist_id, position, kind, label, input_name, media_id) VALUES (?, ?, 9, ?, ?, ?, ?)',
        )
        .run(id, 'sunday', kind, input ?? '', input, media);
    add('camera', 'input', 'Input 1');
    expect(() => add('unnamed', 'input', null)).toThrow();
    expect(() => add('both', 'media', 'Input 1', 'clip')).toThrow();
    expect(() => add('odd', 'odd', null)).toThrow();
    // Adding it told nodes the playlist changed.
    expect(stamps(db)).not.toEqual(times);
    // A playlist removed for good takes its items with it, the input item too.
    db.prepare("DELETE FROM playlists WHERE id = 'sunday'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlist_items').get()).toEqual({ n: 0 });
    db.close();
  });
});
