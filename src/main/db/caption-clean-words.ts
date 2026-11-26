import type { CaptionWord } from '../../shared/caption-words';
import { parseCleanWords } from '../../shared/caption-clean/words';
import type { Db } from './database';

/**
 * The admin's words left out of captions, in the library (alpha.24, QA24-CAPCLEAN-1, migration 094): each
 * language's words in the admin's order. Read and written only by the main process; never logged.
 */
export class CaptionCleanWordsRepo {
  constructor(private readonly db: Db) {}

  get(): CaptionWord[] {
    const rows = this.db
      .prepare('SELECT language, word FROM caption_clean_words ORDER BY language, position')
      .all() as { language: string; word: string }[];
    return parseCleanWords(rows);
  }

  /** The list, whole, in place of the one kept: each word checked, repeats and any past 200 a language left out. */
  set(words: readonly CaptionWord[]): void {
    const kept = parseCleanWords(words);
    const insert = this.db.prepare(
      'INSERT INTO caption_clean_words (language, position, word) VALUES (@language, @position, @word)',
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM caption_clean_words').run();
      const next = new Map<string, number>();
      for (const w of kept) {
        const position = next.get(w.language) ?? 0;
        next.set(w.language, position + 1);
        insert.run({ language: w.language, position, word: w.word });
      }
    })();
  }
}
