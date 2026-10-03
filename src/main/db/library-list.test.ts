import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { MIGRATIONS } from './migrate';
import { PresentationRepo } from './presentations';
import { fillLibrary } from './testing/big-library';
import { summariesOf } from '../../shared/library';

/*
 * The library list must stay cheap in the main process, whose event loop
 * carries every slide change: under 20 ms at 5,000 presentations (a big
 * mandir's library), including turning the answer into an IPC message.
 * Kirtan details travel as the JSON kept on each presentation (migration
 * 15); the operator window reads them (summariesOf), timed here apart.
 */

const BUDGET_MS = 20;
const COUNT = 5000;
let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-big-library-'));
  db = openDatabase(join(dir, 'drashti.sqlite'));
  fillLibrary(db, COUNT);
}, 120_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe(`the library list at ${COUNT} presentations`, () => {
  it(`takes under ${BUDGET_MS} ms in the main process, message included`, () => {
    const repo = new PresentationRepo(db);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      const list = repo.list();
      // The IPC reply is a structured clone of the list; v8.serialize does the same work.
      serialize(list);
      times.push(performance.now() - start);
      expect(list).toHaveLength(COUNT);
    }
    times.sort((a, b) => a - b);
    const median = times[4] ?? Infinity;
    // Reading the kirtan details happens in the operator window, not here; shown for the record.
    const listing = repo.list();
    const readStart = performance.now();
    summariesOf(listing);
    const read = performance.now() - readStart;
    console.log(
      `library list at ${COUNT}: median ${median.toFixed(1)} ms, worst ${times[8]?.toFixed(1)} ms; reading the kirtan details in the window ${read.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it('is in library order, then by name, with each count and kirtan language', () => {
    const list = new PresentationRepo(db).list();
    const byLibrary = list.map((p) => p.libraryName);
    expect(byLibrary.indexOf('Talks')).toBeGreaterThan(byLibrary.lastIndexOf('Kirtans'));
    const kirtans = list.filter((p) => p.libraryName === 'Kirtans').map((p) => p.name);
    expect(kirtans).toEqual([...kirtans].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const first = summariesOf(list).find((p) => p.name === 'Placeholder Kirtan 00000');
    // Presentation 0 has groups of 2 and 3 slides; presentation 1, groups of 3, 4 and 2 (see big-library.ts).
    expect(first).toMatchObject({
      slideCount: 5,
      kirtanTracks: ['en', 'translit'],
      kirtan: { category: 'Placeholder', kavi: 'Placeholder Kavi 0', raag: null, occasions: [] },
    });
    expect(list.find((p) => p.name === 'Placeholder Talk 00001')).toMatchObject({
      slideCount: 9,
      kirtanTracks: null,
      kirtan: null,
    });
  });
});

describe('kirtan details on the list', () => {
  const details = (mem: Db, id: string) =>
    summariesOf(new PresentationRepo(mem).list()).find((p) => p.id === id)?.kirtan;

  it('follow every write to the kirtans table', () => {
    const mem = openDatabase(':memory:');
    const repo = new PresentationRepo(mem);
    const libraryId = repo.ensureLibrary('Default');
    const id = repo.insert({ libraryId, name: 'Becomes a kirtan', groups: [] });
    expect(details(mem, id)).toBeNull();
    // Made a kirtan (as the Kirtan dialog does), its details changed, then not a kirtan.
    mem.prepare("INSERT INTO kirtans (presentation_id, category) VALUES (?, 'Dhun')").run(id);
    expect(details(mem, id)).toEqual({ category: 'Dhun', kavi: null, raag: null, occasions: [] });
    mem
      .prepare(
        `UPDATE kirtans SET kavi = 'Placeholder Kavi', raag = 'Placeholder Raag', occasions = '["Placeholder Day"]' WHERE presentation_id = ?`,
      )
      .run(id);
    expect(details(mem, id)).toEqual({
      category: 'Dhun',
      kavi: 'Placeholder Kavi',
      raag: 'Placeholder Raag',
      occasions: ['Placeholder Day'],
    });
    mem.prepare('DELETE FROM kirtans WHERE presentation_id = ?').run(id);
    expect(details(mem, id)).toBeNull();
    // Content replaced with kirtan details (an import or Undo), then without.
    repo.replace(id, {
      libraryId,
      name: 'Becomes a kirtan',
      groups: [],
      kirtan: { category: 'Arti', occasions: ['A', 'B'] },
    });
    expect(details(mem, id)).toEqual({ category: 'Arti', kavi: null, raag: null, occasions: ['A', 'B'] });
    repo.replace(id, { libraryId, name: 'Becomes a kirtan', groups: [] });
    expect(details(mem, id)).toBeNull();
    // Categories in use come from the table, removed presentations left out.
    const other = repo.insert({ libraryId, name: 'Other', groups: [], kirtan: { category: 'Thal' } });
    repo.insert({ libraryId, name: 'Third', groups: [], kirtan: { category: 'Arti' } });
    expect(repo.kirtanCategories()).toEqual(['Arti', 'Thal']);
    mem.prepare("UPDATE presentations SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(other);
    expect(repo.kirtanCategories()).toEqual(['Arti']);
    mem.close();
  });

  it('are filled in for a library made before they were kept (migration 15)', () => {
    const file = join(dir, 'before-15.sqlite');
    const older = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 14),
    );
    older.exec(`
      INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
      INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'A kirtan'), ('p2', 'lib', 'A talk');
      INSERT INTO kirtans (presentation_id, category, kavi, occasions) VALUES ('p1', 'Kirtan', 'Placeholder Kavi', '["Placeholder Day"]');
    `);
    older.close();
    const upgraded = openDatabase(file);
    expect(details(upgraded, 'p1')).toEqual({
      category: 'Kirtan',
      kavi: 'Placeholder Kavi',
      raag: null,
      occasions: ['Placeholder Day'],
    });
    expect(details(upgraded, 'p2')).toBeNull();
    upgraded.close();
  });

  it('read as nothing when the stored JSON is not details', () => {
    const listing = {
      id: 'x',
      name: 'x',
      libraryName: 'x',
      slideCount: 0,
      width: 1,
      height: 1,
      kirtanTracks: null,
    };
    expect(summariesOf([{ ...listing, kirtan: 'not json' }])[0]?.kirtan).toBeNull();
    expect(summariesOf([{ ...listing, kirtan: '{"category":3,"occasions":["a",1]}' }])[0]?.kirtan).toEqual({
      category: null,
      kavi: null,
      raag: null,
      occasions: ['a'],
    });
  });
});

describe('stored slide counts', () => {
  it('follow the content when a presentation is replaced, counting enabled slides only', () => {
    const mem = openDatabase(':memory:');
    const repo = new PresentationRepo(mem);
    const libraryId = repo.ensureLibrary('Default');
    const id = repo.insert({
      libraryId,
      name: 'Changing',
      groups: [{ name: 'G', slides: [{ elements: [] }, { elements: [], enabled: false }, { elements: [] }] }],
    });
    expect(repo.list()[0]).toMatchObject({ slideCount: 2, kirtanTracks: null });
    repo.replace(id, {
      libraryId,
      name: 'Changing',
      groups: [
        {
          name: 'G',
          slides: [
            {
              elements: [
                {
                  id: 't',
                  kind: 'text',
                  frame: { x: 0, y: 0, width: 100, height: 100 },
                  text: 'એક\nOne',
                  lang: 'gu',
                  style: {
                    fontFamily: null,
                    fontSize: 60,
                    fontWeight: 400,
                    color: '#ffffff',
                    align: 'center',
                    verticalAlign: 'middle',
                    lineHeight: 1.2,
                    shadow: false,
                  },
                  runs: [
                    { text: 'એક\n', lang: 'gu' },
                    { text: 'One', lang: 'en' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      kirtan: { category: 'Kirtan' },
    });
    // A kirtan's languages are those of its words.
    expect(repo.list()[0]).toMatchObject({ slideCount: 1, kirtanTracks: ['en', 'gu'] });
  });

  it('are filled in for a library made before they were kept (migration 5)', () => {
    const file = join(dir, 'older.sqlite');
    const older = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 4),
    );
    older.exec(`
      INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
      INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'Older kirtan'), ('p2', 'lib', 'Older talk'), ('p3', 'lib', 'Empty kirtan');
      INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g1', 'p1', 'G', 0), ('g2', 'p2', 'G', 0);
      INSERT INTO slides (id, group_id, position) VALUES ('s1', 'g1', 0), ('s2', 'g1', 1), ('s3', 'g2', 0);
      INSERT INTO slides (id, group_id, position, enabled) VALUES ('s4', 'g2', 1, 0);
      INSERT INTO kirtans (presentation_id) VALUES ('p1'), ('p3');
      INSERT INTO kirtan_tracks (kirtan_id, lang) VALUES ('p1', 'translit'), ('p1', 'gu');
    `);
    older.close();
    const upgraded = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 10),
    );
    // What migration 5 stored (migration 11 works the languages out from the words instead).
    expect(
      upgraded.prepare('SELECT name, slide_count, kirtan_tracks FROM presentations ORDER BY name').all(),
    ).toEqual([
      { name: 'Empty kirtan', slide_count: 0, kirtan_tracks: '' },
      { name: 'Older kirtan', slide_count: 2, kirtan_tracks: 'gu,translit' },
      { name: 'Older talk', slide_count: 1, kirtan_tracks: null },
    ]);
    upgraded.close();
  });
});
