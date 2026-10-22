import { describe, expect, it } from 'vitest';
import { type Db, openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import {
  KIRTAN_PRESENTATION_NAME,
  PLACEHOLDERS_CHECKED_KEY,
  seedLibrary,
  seedPlaceholders,
  TEST_PRESENTATION_NAME,
} from '../db/seed';
import { placeholderUses, removeUntouchedPlaceholders } from './placeholders';

/*
 * The placeholder presentations an earlier Drashti put in every new library (Session 50): at the first start of
 * this version each one goes, as the library's trash takes it, only when it is exactly as Drashti made it and
 * nothing in the library names it. One changed, saved again or used stays; the log says which and why; and it
 * happens once. Placeholder content only.
 */

/** A library as an earlier Drashti left it: its two placeholders seeded, never looked at since. */
function earlierLibrary(): { db: Db; repo: PresentationRepo; id: (name: string) => string } {
  const db = openDatabase(':memory:');
  seedPlaceholders(db);
  const repo = new PresentationRepo(db);
  const id = (name: string) => repo.list().find((p) => p.name === name)?.id ?? '';
  return { db, repo, id };
}

const removed = (name: string) =>
  `Removed the placeholder presentation “${name}”: unchanged and in no playlist`;
const kept = (name: string, why: string) => `Kept the placeholder presentation “${name}”: ${why}`;
const names = (repo: PresentationRepo) => repo.list().map((p) => p.name);
const checked = (db: Db) =>
  db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(PLACEHOLDERS_CHECKED_KEY) !== undefined;

/** A new playlist (or template) holding the presentation; returns the item. */
function inPlaylist(db: Db, presentationId: string, template = false): { playlist: string; item: string } {
  const playlists = new PlaylistRepo(db);
  const playlist = playlists.create('Placeholder Sunday', null, false, template) ?? '';
  const [item] = playlists.addItems(playlist, null, [{ kind: 'presentation', presentationId }]);
  return { playlist, item: item ?? '' };
}

describe('the placeholder presentations at the first start of this version (Session 50)', () => {
  it('removes each one as Drashti made it and in no playlist, as the trash does (it can come back), once', () => {
    const { db, repo, id } = earlierLibrary();
    const testId = id(TEST_PRESENTATION_NAME);
    expect(removeUntouchedPlaceholders(db)).toEqual([
      removed(TEST_PRESENTATION_NAME),
      removed(KIRTAN_PRESENTATION_NAME),
    ]);
    expect(names(repo)).toEqual([]);
    expect(checked(db)).toBe(true);
    // Kept 30 days, as the library's trash keeps what it takes: it can be brought back.
    expect(repo.restore([testId])).toEqual([testId]);
    // Once: the next start leaves the library alone.
    expect(removeUntouchedPlaceholders(db)).toEqual([]);
    expect(names(repo)).toEqual([TEST_PRESENTATION_NAME]);
  });

  it('keeps one whose words, slides, groups or settings differ in any way from what Drashti made', () => {
    // Each change on its own, made straight in the library (so only the comparison can see it), to the
    // language test slides (the first presentation, slide, element and group made).
    const first = (table: string) => `(SELECT MIN(rowid) FROM ${table})`;
    for (const change of [
      `UPDATE elements SET props = json_set(props, '$.text', 'Placeholder words, changed') WHERE rowid = ${first('elements')}`,
      `UPDATE elements SET x = x + 1 WHERE rowid = ${first('elements')}`,
      `DELETE FROM elements WHERE rowid = ${first('elements')}`,
      `UPDATE slides SET label = 'Placeholder label' WHERE rowid = ${first('slides')}`,
      `UPDATE slides SET enabled = 0 WHERE rowid = ${first('slides')}`,
      `UPDATE slide_groups SET color = '#8e4ec6' WHERE rowid = ${first('slide_groups')}`,
      `UPDATE presentations SET notes = 'Placeholder notes' WHERE rowid = ${first('presentations')}`,
      `UPDATE presentations SET loop = 1 WHERE rowid = ${first('presentations')}`,
    ]) {
      const { db, repo } = earlierLibrary();
      db.prepare(change).run();
      expect(removeUntouchedPlaceholders(db), change).toEqual([
        kept(TEST_PRESENTATION_NAME, 'changed'),
        removed(KIRTAN_PRESENTATION_NAME),
      ]);
      expect(names(repo), change).toEqual([TEST_PRESENTATION_NAME]);
    }
  });

  it('keeps one saved again just as it was (the slide editor’s Save, say)', () => {
    const { db, repo, id } = earlierLibrary();
    const rows = repo.content(id(KIRTAN_PRESENTATION_NAME));
    if (!rows) throw new Error('The sample kirtan has no content');
    repo.setContent(rows);
    expect(removeUntouchedPlaceholders(db)).toEqual([
      removed(TEST_PRESENTATION_NAME),
      kept(KIRTAN_PRESENTATION_NAME, 'changed'),
    ]);
    expect(names(repo)).toEqual([KIRTAN_PRESENTATION_NAME]);
  });

  it('keeps one in a playlist: an item, a template’s filled slot, an item taken out, a deleted playlist’s', () => {
    const ways: { what: string; put: (db: Db, presentationId: string) => void }[] = [
      { what: 'an item of a playlist', put: (db, p) => inPlaylist(db, p) },
      {
        what: 'a template’s slot filled with it',
        put: (db, p) => {
          const playlists = new PlaylistRepo(db);
          const template = playlists.create('Placeholder template', null, false, true) ?? '';
          const slot = playlists.addSlot(template, null, 'Kirtan', 'Kirtan') ?? '';
          expect(playlists.fillPlaceholder(slot, p)).toBe(true);
        },
      },
      {
        what: 'an item taken out of its playlist',
        put: (db, p) => {
          const { item } = inPlaylist(db, p);
          expect(new PlaylistRepo(db).removeItems([item])).toEqual([item]);
        },
      },
      {
        what: 'an item of a deleted playlist',
        put: (db, p) => {
          const { playlist } = inPlaylist(db, p);
          expect(new PlaylistRepo(db).remove([playlist])).toContain(playlist);
        },
      },
    ];
    for (const way of ways) {
      const { db, repo, id } = earlierLibrary();
      way.put(db, id(KIRTAN_PRESENTATION_NAME));
      expect(removeUntouchedPlaceholders(db), way.what).toEqual([
        removed(TEST_PRESENTATION_NAME),
        kept(KIRTAN_PRESENTATION_NAME, 'in a playlist'),
      ]);
      expect(names(repo), way.what).toEqual([KIRTAN_PRESENTATION_NAME]);
    }
  });

  it('keeps one an arti schedule names; one changed and in a playlist says both', () => {
    const { db, repo, id } = earlierLibrary();
    db.prepare(
      "INSERT INTO arti_schedules (id, name, presentation_id, time) VALUES ('placeholder-arti', 'Placeholder arti', ?, '19:00')",
    ).run(id(TEST_PRESENTATION_NAME));
    const kirtan = id(KIRTAN_PRESENTATION_NAME);
    db.prepare(
      "UPDATE slides SET notes = 'Placeholder note' WHERE group_id IN (SELECT id FROM slide_groups WHERE presentation_id = ?)",
    ).run(kirtan);
    inPlaylist(db, kirtan);
    expect(removeUntouchedPlaceholders(db)).toEqual([
      kept(TEST_PRESENTATION_NAME, 'in an arti schedule'),
      kept(KIRTAN_PRESENTATION_NAME, 'changed and in a playlist'),
    ]);
    expect(names(repo)).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME].sort());
  });

  it('removes the sample kirtan as alpha.0 to alpha.4 made it too (its Chorus red, before Session 26g)', () => {
    const { db, repo } = earlierLibrary();
    db.prepare("UPDATE slide_groups SET color = '#e5484d' WHERE name = 'Chorus'").run();
    expect(removeUntouchedPlaceholders(db)).toEqual([
      removed(TEST_PRESENTATION_NAME),
      removed(KIRTAN_PRESENTATION_NAME),
    ]);
    expect(names(repo)).toEqual([]);
  });

  it('never touches anything else: the operator’s presentations, one with a placeholder’s name, the templates', () => {
    const { db, repo, id } = earlierLibrary();
    const seeded = [id(TEST_PRESENTATION_NAME), id(KIRTAN_PRESENTATION_NAME)];
    const libraryId = repo.ensureLibrary('Default');
    const groups = [{ name: 'Verse', slides: [{ elements: [] }] }];
    repo.insert({
      libraryId,
      name: 'Placeholder Song',
      groups,
      source: { kind: 'pp6', path: '/placeholder/Placeholder Song.pro6', ref: 'E2E-SONG', importedAt: null },
    });
    // Imported from a file of the same name, and made in Drashti: the operator's own.
    repo.insert({
      libraryId,
      name: TEST_PRESENTATION_NAME,
      groups,
      source: {
        kind: 'pp6',
        path: '/placeholder/Language test slides.pro6',
        ref: 'E2E-LANG',
        importedAt: null,
      },
    });
    repo.insert({
      libraryId,
      name: KIRTAN_PRESENTATION_NAME,
      groups,
      source: { kind: 'drashti', path: null, ref: null, importedAt: null },
    });
    seedLibrary(db, { placeholders: false });
    const templates = new PlaylistRepo(db).tree(true).map((t) => t.name);
    expect(templates).toHaveLength(2);
    expect(removeUntouchedPlaceholders(db)).toEqual([
      removed(TEST_PRESENTATION_NAME),
      removed(KIRTAN_PRESENTATION_NAME),
    ]);
    const left = repo.list();
    expect(left.map((p) => p.name)).toEqual(
      [KIRTAN_PRESENTATION_NAME, TEST_PRESENTATION_NAME, 'Placeholder Song'].sort(),
    );
    expect(left.some((p) => seeded.includes(p.id))).toBe(false);
    expect(new PlaylistRepo(db).tree(true).map((t) => t.name)).toEqual(templates);
  });

  it('in a new library: nothing to remove, and the placeholders the tests seed at its first start stay', () => {
    const db = openDatabase(':memory:');
    expect(removeUntouchedPlaceholders(db)).toEqual([]);
    expect(checked(db)).toBe(true);
    seedLibrary(db, { placeholders: true });
    expect(removeUntouchedPlaceholders(db)).toEqual([]);
    expect(new PresentationRepo(db).list()).toHaveLength(2);
  });

  it('counts every row that names a presentation but its own content: a table added later keeps one too', () => {
    const { db, repo, id } = earlierLibrary();
    expect(placeholderUses(db)).toEqual([
      { table: 'arti_schedules', column: 'presentation_id' },
      { table: 'playlist_items', column: 'presentation_id' },
    ]);
    db.exec('CREATE TABLE placeholder_shown (presentation_id TEXT REFERENCES presentations(id))');
    db.prepare('INSERT INTO placeholder_shown (presentation_id) VALUES (?)').run(id(TEST_PRESENTATION_NAME));
    expect(placeholderUses(db)).toContainEqual({ table: 'placeholder_shown', column: 'presentation_id' });
    expect(removeUntouchedPlaceholders(db)).toEqual([
      kept(TEST_PRESENTATION_NAME, 'used in the library (placeholder_shown)'),
      removed(KIRTAN_PRESENTATION_NAME),
    ]);
    expect(names(repo)).toEqual([TEST_PRESENTATION_NAME]);
  });
});
