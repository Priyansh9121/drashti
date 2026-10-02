import Database from 'better-sqlite3';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { LATEST_VERSION, migrate, MIGRATIONS, schemaVersion } from './migrate';
import { slideLines } from '../../shared/tracks';
import { PresentationRepo } from './presentations';

const tables = (db: Database.Database) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

describe('migrations', () => {
  it('create the whole core model on a fresh database', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'app_meta',
        'libraries',
        'presentations',
        'slide_groups',
        'slides',
        'elements',
        'arrangements',
        'arrangement_groups',
        'kirtans',
        'kirtan_auto_lines',
        'media',
        'playlists',
        'playlist_items',
        'shastra_texts',
        'shastra_sections',
        'shastra_verses',
        'shastra_verse_texts',
        'themes',
        'looks',
        'screen_groups',
        'screens',
        'nodes',
        'stage_layouts',
        'props',
        'messages',
        'timers',
        'macros',
        'stream_profiles',
        'users',
      ]),
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('do nothing the second time', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
    db.close();
  });

  it('refuse a database from a newer Drashti', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 999');
    expect(() => migrate(db)).toThrow(/newer Drashti/);
    db.close();
  });

  it('roll back a failing migration completely', () => {
    const db = openDatabase(':memory:');
    const broken = [
      ...MIGRATIONS,
      { version: LATEST_VERSION + 1, name: 'broken', up: 'CREATE TABLE half_done (x); THIS IS NOT SQL;' },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(tables(db)).not.toContain('half_done');
    db.close();
  });

  it('back up the database before upgrading it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    openDatabase(file).close();
    const next = [
      ...MIGRATIONS,
      { version: LATEST_VERSION + 1, name: 'test', up: 'CREATE TABLE later (x TEXT);' },
    ];
    const db = openDatabase(file, next);
    expect(schemaVersion(db)).toBe(LATEST_VERSION + 1);
    db.close();
    const backup = join(dir, `drashti.sqlite.v${LATEST_VERSION}.bak`);
    expect(existsSync(backup)).toBe(true);
    const old = new Database(backup, { readonly: true });
    expect(schemaVersion(old)).toBe(LATEST_VERSION);
    old.close();
  });

  it('upgrade a version 1 library to the latest schema, keeping its presentations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v1 = openDatabase(file, MIGRATIONS.slice(0, 1));
    v1.prepare("INSERT INTO libraries (id, name) VALUES ('l', 'Default')").run();
    v1.prepare("INSERT INTO presentations (id, library_id, name) VALUES ('p', 'l', 'Kept')").run();
    v1.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(existsSync(join(dir, 'drashti.sqlite.v1.bak'))).toBe(true);
    expect(db.prepare('SELECT name, source_hash, deleted_at FROM presentations').all()).toEqual([
      { name: 'Kept', source_hash: null, deleted_at: null },
    ]);
    expect(tables(db)).toEqual(expect.arrayContaining(['import_runs', 'import_items', 'import_issues']));
    db.close();
  });

  it('upgrade a version 9 library for the slide editor, every slide looking and playing as before', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v9 = openDatabase(file, MIGRATIONS.slice(0, 9));
    v9.prepare("INSERT INTO libraries (id, name) VALUES ('l', 'Default')").run();
    v9.prepare("INSERT INTO presentations (id, library_id, name) VALUES ('p', 'l', 'Placeholder')").run();
    v9.prepare(
      "INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', 'p', 'Verse', 0)",
    ).run();
    v9.prepare("INSERT INTO slides (id, group_id, position) VALUES ('s', 'g', 0)").run();
    // A shape and a text box as Drashti stored them before Session 7.
    const shape = JSON.stringify({ fill: '#123456', cornerRadius: 12, opacity: 0.5 });
    const words = JSON.stringify({
      text: 'Placeholder line',
      lang: 'en',
      style: {
        fontFamily: null,
        fontSize: 72,
        fontWeight: 400,
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        shadow: true,
      },
      runs: [{ text: 'Placeholder line', shadow: false }],
    });
    const element = v9.prepare(
      'INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    element.run('e1', 's', 0, 'shape', 0, 0, 100, 50, shape);
    element.run('e2', 's', 1, 'text', 10, 20, 300, 40, words);
    v9.close();

    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(db.prepare("SELECT transition, loop FROM presentations WHERE id = 'p'").get()).toEqual({
      transition: null,
      loop: 0,
    });
    // The elements' own data is untouched.
    expect(db.prepare('SELECT id, rotation, props FROM elements ORDER BY position').all()).toEqual([
      { id: 'e1', rotation: 0, props: shape },
      { id: 'e2', rotation: 0, props: words },
    ]);
    const doc = new PresentationRepo(db).get('p');
    expect(doc).toMatchObject({ transition: null, loop: false });
    const slide = doc?.groups[0]?.slides[0];
    expect(slide).toMatchObject({ transition: null, autoAdvanceMs: null });
    // Read exactly as before: nothing added (no shape kind, outline or rotation).
    expect(slide?.slide.elements).toEqual([
      {
        id: 'e1',
        kind: 'shape',
        frame: { x: 0, y: 0, width: 100, height: 50 },
        fill: '#123456',
        cornerRadius: 12,
        opacity: 0.5,
      },
      { id: 'e2', kind: 'text', frame: { x: 10, y: 20, width: 300, height: 40 }, ...JSON.parse(words) },
    ]);
    db.close();
  });

  it('upgrade a version 10 library for the kirtan library, putting every track line into its slide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v10 = openDatabase(file, MIGRATIONS.slice(0, 10));
    const style = {
      fontFamily: null,
      fontSize: 72,
      fontWeight: 400,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      shadow: true,
    };
    // A Gujarati line on the slide, with its transliteration in the same box; the English and Hindi
    // lines only in the track table, and the transliteration there too (so nothing to add for it).
    const words = JSON.stringify({
      text: 'નમૂનો\nNamuno',
      lang: 'gu',
      style,
      runs: [
        { text: 'નમૂનો\n', lang: 'gu', size: 90 },
        { text: 'Namuno', lang: 'translit', size: 60 },
      ],
      kept: 'data Drashti does not know',
    });
    v10.exec(`
      INSERT INTO libraries (id, name) VALUES ('l', 'Default');
      INSERT INTO presentations (id, library_id, name) VALUES ('p', 'l', 'Placeholder kirtan'), ('q', 'l', 'Picture kirtan');
      INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', 'p', 'Verse', 0), ('h', 'q', 'Verse', 0);
      INSERT INTO slides (id, group_id, position) VALUES ('s', 'g', 0), ('t', 'h', 0);
      INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props)
        VALUES ('e', 's', 0, 'text', 100, 200, 1720, 600, '${words}');
      INSERT INTO kirtans (presentation_id, category, kavi, occasion) VALUES ('p', 'kirtan', 'Placeholder Kavi', 'Diwali'), ('q', NULL, NULL, NULL);
      INSERT INTO kirtan_tracks (kirtan_id, lang) VALUES ('p', 'gu'), ('p', 'translit'), ('p', 'en'), ('p', 'hi'), ('q', 'en');
      INSERT INTO kirtan_track_lines (kirtan_id, lang, slide_id, text) VALUES
        ('p', 'gu', 's', 'નમૂનો'), ('p', 'translit', 's', 'Namuno'), ('p', 'en', 's', 'Sample'), ('p', 'hi', 's', 'नमूना'),
        ('q', 'en', 't', 'Only here');
    `);
    v10.close();

    const db = openDatabase(file);
    expect(tables(db)).not.toContain('kirtan_track_lines');
    expect(tables(db)).not.toContain('kirtan_tracks');
    const repo = new PresentationRepo(db);
    const doc = repo.get('p');
    const elements = doc?.groups[0]?.slides[0]?.slide.elements ?? [];
    expect(slideLines(elements).lines).toEqual({
      gu: ['નમૂનો'],
      hi: ['नमूना'],
      translit: ['Namuno'],
      en: ['Sample'],
    });
    // Hindi goes with the Gujarati, English at the end; what was there is unchanged, and so is unknown data.
    const stored = JSON.parse(
      (db.prepare("SELECT props FROM elements WHERE id = 'e'").get() as { props: string }).props,
    ) as { text: string; runs: unknown[]; kept: string };
    expect(stored.text).toBe('નમૂનો\nनमूना\nNamuno\nSample');
    expect(stored.runs[0]).toEqual({ text: 'નમૂનો\n', lang: 'gu', size: 90 });
    expect(stored.kept).toBe('data Drashti does not know');
    expect(doc?.kirtan).toMatchObject({
      category: 'Kirtan',
      kavi: 'Placeholder Kavi',
      occasions: ['Diwali'],
    });
    // A slide with no text box gets one for its line.
    expect(slideLines(repo.get('q')?.groups[0]?.slides[0]?.slide.elements ?? []).lines).toEqual({
      en: ['Only here'],
    });
    expect(repo.list().map((p) => [p.name, p.kirtanTracks])).toEqual([
      ['Picture kirtan', ['en']],
      ['Placeholder kirtan', ['en', 'gu', 'hi', 'translit']],
    ]);
    db.close();
  });
});
