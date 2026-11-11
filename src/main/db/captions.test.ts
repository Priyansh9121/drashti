import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS } from '../../shared/captions';
import { CaptionSettingsRepo } from './captions';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';

/*
 * Live captions' settings in the library (Session 55, Part 10, migration 066): the language listened for, the
 * audience screens too or not, and the captions' size and place. Never a word heard: the library keeps none.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-captions-db-'));
});
afterEach(() => {
  // SQLite is closed by each test before the folder goes (Windows keeps open files).
  rmSync(dir, { recursive: true, force: true });
});

describe('captions settings in the library', () => {
  it('upgrade an alpha.14 library (57; 062–065 are Part 17b’s): the defaults, everything else as it was', () => {
    const file = join(dir, 'library.sqlite');
    const v57 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 57),
    );
    expect(schemaVersion(v57)).toBe(57);
    v57.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(MIGRATIONS.some((m) => m.version === 66 && m.name === 'live captions')).toBe(true);
    expect(new CaptionSettingsRepo(db).get()).toEqual(DEFAULT_CAPTION_SETTINGS);
    db.close();
  });

  it('upgrades an alpha.15 library so it can save Sanskrit and keep the other caption settings', () => {
    const file = join(dir, 'library.sqlite');
    const previous = openDatabase(
      file,
      MIGRATIONS.filter((migration) => migration.version <= 68),
    );
    const settings = { language: 'gu', audience: true, size: 'large', place: 'top' } as const;
    try {
      expect(schemaVersion(previous)).toBe(68);
      new CaptionSettingsRepo(previous).set(settings);
    } finally {
      previous.close();
    }

    const current = openDatabase(file);
    try {
      const repo = new CaptionSettingsRepo(current);
      expect(repo.get()).toEqual(settings);
      const sanskrit = { ...settings, language: 'sa' } as const;
      repo.set(sanskrit);
      expect(repo.get()).toEqual(sanskrit);
    } finally {
      current.close();
    }
  });

  it('keep what the admin chose, and refuse what is not a setting', () => {
    const db = openDatabase(join(dir, 'library.sqlite'));
    const repo = new CaptionSettingsRepo(db);
    repo.set({ language: 'gu', audience: true, size: 'large', place: 'top' });
    expect(repo.get()).toEqual({ language: 'gu', audience: true, size: 'large', place: 'top' });
    expect(() => db.prepare("UPDATE caption_settings SET language = 'fr'").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE caption_settings SET size = 'huge'").run()).toThrow(/CHECK/);
    expect(() => db.prepare('INSERT INTO caption_settings (id) VALUES (2)').run()).toThrow(/CHECK/);
    expect(repo.get().language).toBe('gu');
    db.close();
  });
});
