import {
  CAPTION_HINTS_ON,
  isCaptionLanguage,
  parseCaptionWords,
  type CaptionWord,
} from '../../shared/caption-words';
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

  /** Each language's switch for the hints: its row once the admin changed it, else CAPTION_HINTS_ON's. */
  hintsOn(): Record<SpeechLanguage, boolean> {
    const rows = this.db.prepare('SELECT language, hints FROM caption_word_hints').all() as {
      language: string;
      hints: number;
    }[];
    const on = { ...CAPTION_HINTS_ON };
    for (const row of rows) if (isCaptionLanguage(row.language)) on[row.language] = row.hints === 1;
    return on;
  }

  setHintsOn(language: SpeechLanguage, on: boolean): void {
    this.db
      .prepare(
        'INSERT INTO caption_word_hints (language, hints) VALUES (?, ?) ON CONFLICT (language) DO UPDATE SET hints = excluded.hints',
      )
      .run(language, on ? 1 : 0);
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
