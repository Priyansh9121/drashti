import Database from 'better-sqlite3';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { LATEST_VERSION, migrate, MIGRATIONS, schemaVersion } from './migrate';

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
        'kirtan_tracks',
        'kirtan_track_lines',
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

  it('upgrade a version 1 library to the import tables, keeping its presentations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
    const file = join(dir, 'drashti.sqlite');
    const v1 = openDatabase(file, MIGRATIONS.slice(0, 1));
    v1.prepare("INSERT INTO libraries (id, name) VALUES ('l', 'Default')").run();
    v1.prepare("INSERT INTO presentations (id, library_id, name) VALUES ('p', 'l', 'Kept')").run();
    v1.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(2);
    expect(existsSync(join(dir, 'drashti.sqlite.v1.bak'))).toBe(true);
    expect(db.prepare('SELECT name, source_hash FROM presentations').all()).toEqual([
      { name: 'Kept', source_hash: null },
    ]);
    expect(tables(db)).toEqual(expect.arrayContaining(['import_runs', 'import_items', 'import_issues']));
    db.close();
  });
});
