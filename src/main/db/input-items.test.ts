import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPEAT_REFUSES } from '../../shared/repeat';
import { inputNamed, type VideoInput } from '../../shared/video-inputs';
import { type Db, openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { PlaylistRepo } from './playlists';
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

describe('a video input as a playlist item', () => {
  /** This computer's one video input; another computer has none of its name. */
  const here: VideoInput = { id: 'here-1', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };
  const thisComputer = (name: string) => inputNamed([here], name);
  const another = (name: string) => inputNamed([], name);

  it('is added from this computer’s list by its name, as Media names it, and plays as that input', () => {
    const db = openDatabase(':memory:');
    const playlists = new PlaylistRepo(db, thisComputer);
    const id = playlists.create('Placeholder Sunday', null, false) ?? '';
    const [item] = playlists.addItems(id, null, [{ kind: 'input', name: ' input 1' }]);
    if (!item) throw new Error('not added');
    expect(playlists.itemsOf(id)).toEqual([
      { id: item, kind: 'input', label: 'Input 1', name: 'Input 1', missing: false, timers: [] },
    ]);
    expect(playlists.playItems(id)).toEqual([
      { id: item, kind: 'input', inputId: 'here-1', label: 'Input 1', timers: [] },
    ]);
    // Only an input this computer has can be added (Media lists no other).
    expect(playlists.addItems(id, null, [{ kind: 'input', name: 'Input 9' }])).toEqual([]);
    expect(playlists.itemsOf(id)).toHaveLength(1);
    db.close();
  });

  it('on a computer without an input of its name: marked so, and Next goes past it, saying why', () => {
    const file = join(dir, 'library.sqlite');
    const made = openDatabase(file);
    const id = new PlaylistRepo(made, thisComputer).create('Placeholder Sunday', null, false) ?? '';
    const [item] = new PlaylistRepo(made, thisComputer).addItems(id, null, [
      { kind: 'input', name: 'Input 1' },
    ]);
    made.close();
    // The library carried to another computer.
    const db = openDatabase(file);
    const playlists = new PlaylistRepo(db, another);
    expect(playlists.itemsOf(id)).toEqual([
      { id: item, kind: 'input', label: 'Input 1', name: 'Input 1', missing: true, timers: [] },
    ]);
    expect(playlists.playItems(id)).toEqual([
      { id: item, kind: 'skip', why: 'The video input “Input 1” is not on this computer' },
    ]);
    // Back on a computer that has it, as named there.
    const renamed = (name: string) => inputNamed([{ ...here, id: 'there-7', name: 'INPUT 1' }], name);
    expect(new PlaylistRepo(db, renamed).playItems(id)).toEqual([
      { id: item, kind: 'input', inputId: 'there-7', label: 'Input 1', timers: [] },
    ]);
    db.close();
  });

  it('runs timer cues, goes into a template and a playlist made from it, and Repeat Slides refuses it', () => {
    const db = openDatabase(':memory:');
    const playlists = new PlaylistRepo(db, thisComputer);
    const id = playlists.create('Placeholder Sunday', null, false) ?? '';
    const [item] = playlists
      .addItems(id, null, [
        { kind: 'header', label: 'Pravachan' },
        { kind: 'input', name: 'Input 1' },
      ])
      .slice(1);
    if (!item) throw new Error('not added');
    expect(playlists.setTimers(item, [{ timerId: 'placeholder-timer', action: 'start' }])).toBe(true);
    const timers = [{ timerId: 'placeholder-timer', action: 'start' }];
    expect(playlists.itemsOf(id)[1]).toMatchObject({ kind: 'input', timers });
    expect(playlists.playItems(id)?.[1]).toMatchObject({ kind: 'input', timers });
    const template = playlists.saveAsTemplate(id, 'Placeholder template', []) ?? '';
    const shape = (list: string) =>
      playlists
        .itemsOf(list)
        .map((i) => (i.kind === 'input' ? [i.kind, i.name, i.timers] : [i.kind, i.label]));
    const expected = [
      ['header', 'Pravachan'],
      ['input', 'Input 1', timers],
    ];
    expect(shape(template)).toEqual(expected);
    const next = playlists.newFromTemplate(template, 'Placeholder next Sunday', null) ?? '';
    expect(shape(next)).toEqual(expected);
    // A Repeat Slides playlist goes round pictures and slides only.
    const repeat = playlists.createRepeat('Placeholder lobby', null) ?? '';
    expect(playlists.refusal(repeat, [{ kind: 'input', name: 'Input 1' }])).toBe(REPEAT_REFUSES);
    expect(playlists.addItems(repeat, null, [{ kind: 'input', name: 'Input 1' }])).toEqual([]);
    expect(REPEAT_REFUSES).toContain('a video input');
    db.close();
  });
});
