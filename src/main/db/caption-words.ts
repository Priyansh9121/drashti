import { CAPTION_HINTS_ON, parseCaptionWords, type CaptionWord } from '../../shared/caption-words';
import type { SpeechLanguage } from '../../shared/speech';
import type { Db } from './database';

/** Caption words in the library (alpha.22, migration 091): each language's words in the admin's order. */
export class CaptionWordsRepo {
  constructor(private readonly db: Db) {}

  get(): CaptionWord[] {
    const rows = this.db
      .prepare('SELECT language, word FROM caption_words ORDER BY language, position')
      .all() as { language: string; word: string }[];
    return parseCaptionWords(rows);
  }

  /** Red first: each language's hints switch, not written yet. */
  hintsOn(): Record<SpeechLanguage, boolean> {
    return { ...CAPTION_HINTS_ON };
  }

  setHintsOn(_language: SpeechLanguage, _on: boolean): void {
    void this.db;
  }

  /** The list, whole, in place of the one kept: each word checked, repeats and any past 200 a language left out. */
  set(words: readonly CaptionWord[]): void {
    const kept = parseCaptionWords(words);
    const insert = this.db.prepare(
      'INSERT INTO caption_words (language, position, word) VALUES (@language, @position, @word)',
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM caption_words').run();
      const next = new Map<string, number>();
      for (const w of kept) {
        const position = next.get(w.language) ?? 0;
        next.set(w.language, position + 1);
        insert.run({ language: w.language, position, word: w.word });
      }
    })();
  }
}
