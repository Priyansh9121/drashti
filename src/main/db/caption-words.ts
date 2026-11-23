import type { CaptionWord } from '../../shared/caption-words';
import type { Db } from './database';

/* Caption words in the library (alpha.22, migration 091): red first, not written yet. */
export class CaptionWordsRepo {
  constructor(private readonly db: Db) {}

  get(): CaptionWord[] {
    return [];
  }

  set(_words: readonly CaptionWord[]): void {
    void this.db;
  }
}
