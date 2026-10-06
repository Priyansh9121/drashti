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
        'shastra_items',
        'shastra_item_texts',
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
        'arti_schedules',
        'calendars',
        'calendar_days',
        'quotes',
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

  it('upgrade a version 34 library for pictures (Session 15), keeping every presentation and report as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v34 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 34),
    );
    v34.prepare("INSERT INTO libraries (id, name) VALUES ('l', 'Default')").run();
    const add = v34.prepare(
      `INSERT INTO presentations (id, library_id, name, source_kind, source_path, source_hash, slide_count, deleted_at)
       VALUES (?, 'l', ?, ?, ?, ?, ?, ?)`,
    );
    add.run('a', 'Placeholder A', 'pp7', '/library/a.pro', 'hash-a', 3, null);
    add.run('b', 'Placeholder B', 'text', '/library/b.txt', 'hash-b', 1, '2026-10-01T00:00:00.000Z');
    v34
      .prepare("INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', 'a', 'Verse', 0)")
      .run();
    v34
      .prepare(
        "INSERT INTO kirtans (presentation_id, category, kavi) VALUES ('a', 'Kirtan', 'Placeholder kavi')",
      )
      .run();
    v34.prepare("INSERT INTO search_docs (presentation_id, lines) VALUES ('a', '[]')").run();
    v34.prepare("INSERT INTO import_runs (id, status, paths) VALUES ('r', 'done', '[]')").run();
    v34
      .prepare(
        "INSERT INTO import_items (id, run_id, position, source_path, format, outcome, target_kind, target_id) VALUES ('i', 'r', 0, '/library/a.pro', 'pp7', 'imported', 'presentation', 'a')",
      )
      .run();
    v34
      .prepare(
        "INSERT INTO import_issues (item_id, severity, code, message) VALUES ('i', 'info', 'kirtan', 'Placeholder issue')",
      )
      .run();
    const before = v34.prepare('SELECT rowid, * FROM presentations ORDER BY rowid').all();
    const itemsBefore = v34.prepare('SELECT rowid, * FROM import_items').all();
    v34.close();

    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(db.prepare('SELECT rowid, * FROM presentations ORDER BY rowid').all()).toEqual(before);
    expect(db.prepare('SELECT rowid, * FROM import_items').all()).toEqual(itemsBefore);
    expect(db.prepare("SELECT kirtan FROM presentations WHERE id = 'a'").get()).toEqual({
      kirtan: expect.stringContaining('Placeholder kavi') as unknown,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('presentations', 'import_items')",
        )
        .all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'presentations_by_library',
        'presentations_by_source',
        'presentations_by_source_ref',
        'presentations_by_source_hash',
        'presentations_removed',
        'presentations_listed',
        'import_items_by_run',
      ]),
    );
    // The kirtans' triggers still reach the rebuilt table; deleting cascades as before.
    db.prepare("UPDATE kirtans SET kavi = 'Another placeholder' WHERE presentation_id = 'a'").run();
    expect(db.prepare("SELECT kirtan FROM presentations WHERE id = 'a'").get()).toEqual({
      kirtan: expect.stringContaining('Another placeholder') as unknown,
    });
    // Pictures may come in now.
    db.prepare(
      "INSERT INTO presentations (id, library_id, name, source_kind, source_path) VALUES ('c', 'l', 'Placeholder deck', 'pictures', '/library/deck.pdf')",
    ).run();
    db.prepare(
      "INSERT INTO import_items (id, run_id, position, source_path, format, outcome) VALUES ('j', 'r', 1, '/library/deck.pdf', 'pictures', 'imported')",
    ).run();
    db.prepare("DELETE FROM presentations WHERE id = 'a'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM slide_groups WHERE presentation_id = 'a'").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM search_docs WHERE presentation_id = 'a'").get()).toEqual({
      n: 0,
    });
    db.prepare("DELETE FROM import_items WHERE id = 'i'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_issues').get()).toEqual({ n: 0 });
    db.close();
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

  it('upgrade a version 19 library for Looks: each group shows exactly what it did, in a Standard Look', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v19 = openDatabase(file, MIGRATIONS.slice(0, 19));
    const group = v19.prepare(
      'INSERT INTO screen_groups (id, name, role, position, languages) VALUES (?, ?, ?, ?, ?)',
    );
    group.run('g-hall', 'Hall', 'audience', 0, JSON.stringify(['gu', 'translit']));
    group.run('g-stage', 'Stage', 'stage', 1, JSON.stringify(['gu']));
    group.run('g-lobby', 'Lobby', 'audience', 2, null);
    // Unreadable languages showed every language: they still do.
    group.run('g-odd', 'Odd', 'audience', 3, JSON.stringify(['gu', 'gu']));
    group.run('g-stream', 'Stream', 'stream', 4, JSON.stringify(['translit', 'en']));
    const screen = v19.prepare(
      'INSERT INTO screens (id, group_id, name, canvas_width, position) VALUES (?, ?, ?, ?, ?)',
    );
    screen.run('s-hall', 'g-hall', 'Hall TV', 1280, 0);
    screen.run('s-stage', 'g-stage', 'Stage TV', 1920, 0);
    v19.close();

    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    // One Look, Standard, with each group's languages; nothing else differs from the defaults.
    const looks = db.prepare('SELECT name, definition, position FROM looks').all() as {
      name: string;
      definition: string;
      position: number;
    }[];
    expect(looks.map((l) => [l.name, l.position])).toEqual([['Standard', 0]]);
    expect(JSON.parse(looks[0]?.definition ?? '')).toEqual({
      groups: {
        'g-hall': { languages: ['gu', 'translit'] },
        'g-stage': { languages: ['gu'] },
        'g-stream': { languages: ['translit', 'en'] },
      },
    });
    // The groups and their screens came through the rebuild; the languages left the group.
    expect(db.prepare('SELECT id, name, role, position FROM screen_groups ORDER BY position').all()).toEqual([
      { id: 'g-hall', name: 'Hall', role: 'audience', position: 0 },
      { id: 'g-stage', name: 'Stage', role: 'stage', position: 1 },
      { id: 'g-lobby', name: 'Lobby', role: 'audience', position: 2 },
      { id: 'g-odd', name: 'Odd', role: 'audience', position: 3 },
      { id: 'g-stream', name: 'Stream', role: 'stream', position: 4 },
    ]);
    expect(db.prepare('SELECT id, group_id, canvas_width FROM screens ORDER BY id').all()).toEqual([
      { id: 's-hall', group_id: 'g-hall', canvas_width: 1280 },
      { id: 's-stage', group_id: 'g-stage', canvas_width: 1920 },
    ]);
    const columns = (db.prepare('PRAGMA table_info(screen_groups)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('languages');
    expect(columns).not.toContain('look_id');
    // The screens still belong to their groups: deleting a group still takes its screens.
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.prepare("DELETE FROM screen_groups WHERE id = 'g-stage'").run();
    expect(db.prepare('SELECT id FROM screens').all()).toEqual([{ id: 's-hall' }]);
    // A group can now be a key and fill pair.
    db.prepare("INSERT INTO screen_groups (id, name, role) VALUES ('g-key', 'Key', 'keyfill')").run();
    expect(() =>
      db.prepare("INSERT INTO screen_groups (id, name, role) VALUES ('x', 'X', 'nonsense')").run(),
    ).toThrow();
    db.close();
  });

  it('make a Standard Look on a new library, with every group at the defaults', () => {
    const db = openDatabase(':memory:');
    const looks = db.prepare('SELECT name, definition FROM looks').all();
    expect(looks).toEqual([{ name: 'Standard', definition: JSON.stringify({ groups: {} }) }]);
    db.close();
  });
});
