import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { MIGRATIONS } from './migrate';
import { PresentationRepo } from './presentations';
import { fillLibrary } from './testing/big-library';

/*
 * The library list must stay cheap in the main process, whose event loop
 * carries every slide change: under 20 ms at 5,000 presentations (a big
 * mandir's library), including turning the answer into an IPC message.
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
    console.log(`library list at ${COUNT}: median ${median.toFixed(1)} ms, worst ${times[8]?.toFixed(1)} ms`);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it('is in library order, then by name, with each count and kirtan language', () => {
    const list = new PresentationRepo(db).list();
    const byLibrary = list.map((p) => p.libraryName);
    expect(byLibrary.indexOf('Talks')).toBeGreaterThan(byLibrary.lastIndexOf('Kirtans'));
    const kirtans = list.filter((p) => p.libraryName === 'Kirtans').map((p) => p.name);
    expect(kirtans).toEqual([...kirtans].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const first = list.find((p) => p.name === 'Placeholder Kirtan 00000');
    // Presentation 0 has groups of 2 and 3 slides; presentation 1, groups of 3, 4 and 2 (see big-library.ts).
    expect(first).toMatchObject({ slideCount: 5, kirtanTracks: ['en', 'translit'] });
    expect(list.find((p) => p.name === 'Placeholder Talk 00001')).toMatchObject({
      slideCount: 9,
      kirtanTracks: null,
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
    expect(new PresentationRepo(upgraded).list().map((p) => [p.name, p.slideCount, p.kirtanTracks])).toEqual([
      ['Empty kirtan', 0, []],
      ['Older kirtan', 2, ['gu', 'translit']],
      ['Older talk', 1, null],
    ]);
    upgraded.close();
  });
});
