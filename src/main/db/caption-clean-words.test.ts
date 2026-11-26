import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CaptionWord } from '../../shared/caption-words';
import { CaptionCleanWordsRepo } from './caption-clean-words';
import { CaptionWordsRepo } from './caption-words';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';

/*
 * The admin's words left out of captions, in the library (alpha.24, QA24-CAPCLEAN-1, migration 094): per language,
 * in order, kept with the library's settings (so in its backups), apart from the caption words. Invented placeholder
 * words only, never a real bad word.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-caption-clean-db-'));
});
afterEach(() => {
  // SQLite is closed by each test before the folder goes (Windows keeps open files).
  rmSync(dir, { recursive: true, force: true });
});

describe('the admin’s words left out of captions, in the library', () => {
  it('upgrade a library at 092 to an empty list, keeping the caption words as they were', () => {
    const file = join(dir, 'library.sqlite');
    const v92 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 92),
    );
    new CaptionWordsRepo(v92).set([{ language: 'en', word: 'Zentrova' }]);
    v92.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(MIGRATIONS.some((m) => m.version === 94 && m.name === 'words left out of captions')).toBe(true);
    expect(new CaptionCleanWordsRepo(db).get()).toEqual([]);
    expect(new CaptionWordsRepo(db).get()).toEqual([{ language: 'en', word: 'Zentrova' }]);
    db.close();
  });

  it('keep each language’s words in the admin’s order, the list given whole, checked again', () => {
    const db = openDatabase(join(dir, 'library.sqlite'));
    const repo = new CaptionCleanWordsRepo(db);
    const words: CaptionWord[] = [
      { language: 'en', word: 'Qelmar' },
      { language: 'gu', word: 'ઠંગોપ' },
      { language: 'en', word: 'Vexmor quill' },
      { language: 'hi', word: 'ढ़ुम्पक' },
    ];
    repo.set(words);
    expect(repo.get()).toEqual([
      { language: 'en', word: 'Qelmar' },
      { language: 'en', word: 'Vexmor quill' },
      { language: 'gu', word: 'ઠંગોપ' },
      { language: 'hi', word: 'ढ़ुम्पक' },
    ]);
    // Given whole: a word taken away is gone; a repeat by key, or one that cannot be kept, is not kept.
    repo.set([
      { language: 'en', word: 'Vexmor quill' },
      { language: 'en', word: 'VEXMOR  QUILL' },
      { language: 'en', word: 'Qelmar,' },
    ]);
    expect(repo.get()).toEqual([{ language: 'en', word: 'Vexmor quill' }]);
    // The caption words stay as they were.
    expect(new CaptionWordsRepo(db).get()).toEqual([]);
    db.close();
  });
});
