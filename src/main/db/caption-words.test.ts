import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAPTION_WORDS_PER_LANGUAGE, type CaptionWord } from '../../shared/caption-words';
import { CaptionWordsRepo } from './caption-words';
import { CaptionSettingsRepo } from './captions';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';

/*
 * Caption words in the library (alpha.22, migration 091): the admin's names and terms per language, in order, kept
 * with the library's settings (and so in its backups), never in a recording. Invented placeholder words only.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-caption-words-db-'));
});
afterEach(() => {
  // SQLite is closed by each test before the folder goes (Windows keeps open files).
  rmSync(dir, { recursive: true, force: true });
});

const GU = 'ઝેન્ટ્રોવા';

describe('caption words in the library', () => {
  it('upgrade a library at 090 to an empty list, keeping the captions settings as they were', () => {
    const file = join(dir, 'library.sqlite');
    const v90 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 90),
    );
    // Written as that version's Drashti wrote it (today's repo also writes alpha.24's "Captions in", migration 093).
    v90
      .prepare(
        "UPDATE caption_settings SET language = 'gu', audience = 1, size = 'large', place = 'top' WHERE id = 1",
      )
      .run();
    v90.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(MIGRATIONS.some((m) => m.version === 91 && m.name === 'caption words')).toBe(true);
    expect(new CaptionWordsRepo(db).get()).toEqual([]);
    expect(new CaptionSettingsRepo(db).get()).toEqual({
      language: 'gu',
      audience: true,
      size: 'large',
      place: 'top',
      captionLanguage: 'same',
    });
    db.close();
  });

  it('keeps each language’s words in the order given, and a new list replaces the old one whole', () => {
    const db = openDatabase(join(dir, 'library.sqlite'));
    const repo = new CaptionWordsRepo(db);
    const words: CaptionWord[] = [
      { language: 'gu', word: GU },
      { language: 'en', word: 'Zentrova' },
      { language: 'en', word: 'Person Q7' },
      { language: 'sa', word: 'વેલ્મોરિન' },
    ];
    repo.set(words);
    const kept = repo.get();
    expect(kept.filter((w) => w.language === 'en').map((w) => w.word)).toEqual(['Zentrova', 'Person Q7']);
    expect([...kept].sort((a, b) => a.word.localeCompare(b.word))).toEqual(
      [...words].sort((a, b) => a.word.localeCompare(b.word)),
    );
    repo.set([{ language: 'hi', word: 'वेल्मोरिन' }]);
    expect(repo.get()).toEqual([{ language: 'hi', word: 'वेल्मोरिन' }]);
    db.close();
  });

  it('keeps each language’s hints switch: Gujarati off and the others on until changed', () => {
    const file = join(dir, 'library.sqlite');
    const db = openDatabase(file);
    const repo = new CaptionWordsRepo(db);
    expect(repo.hintsOn()).toEqual({ gu: false, hi: true, sa: true, en: true });
    repo.setHintsOn('gu', true);
    repo.setHintsOn('en', false);
    expect(repo.hintsOn()).toEqual({ gu: true, hi: true, sa: true, en: false });
    db.close();
    const again = openDatabase(file);
    expect(new CaptionWordsRepo(again).hintsOn()).toEqual({ gu: true, hi: true, sa: true, en: false });
    expect(() =>
      again.prepare("INSERT INTO caption_word_hints (language, hints) VALUES ('fr', 1)").run(),
    ).toThrow(/CHECK/);
    again.close();
  });

  it('keeps only words it can use: checked, without repeats, at most 200 a language', () => {
    const db = openDatabase(join(dir, 'library.sqlite'));
    const repo = new CaptionWordsRepo(db);
    repo.set([
      { language: 'en', word: ' Zentrova ' },
      { language: 'en', word: 'zentrova' },
      { language: 'en', word: 'Zentrova, Velmorin' },
      ...Array.from({ length: CAPTION_WORDS_PER_LANGUAGE + 3 }, (_, i) => ({
        language: 'hi' as const,
        word: `वेल्मोरिन${String(i)}`,
      })),
    ]);
    const kept = repo.get();
    expect(kept.filter((w) => w.language === 'en')).toEqual([{ language: 'en', word: 'Zentrova' }]);
    expect(kept.filter((w) => w.language === 'hi')).toHaveLength(CAPTION_WORDS_PER_LANGUAGE);
    // The table itself refuses a language Drashti does not caption, and a word too long.
    expect(() =>
      db.prepare("INSERT INTO caption_words (language, position, word) VALUES ('fr', 0, 'Zeta')").run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare("INSERT INTO caption_words (language, position, word) VALUES ('en', 900, ?)")
        .run('Z'.repeat(41)),
    ).toThrow(/CHECK/);
    db.close();
  });
});
