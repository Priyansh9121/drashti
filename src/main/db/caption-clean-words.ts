import type { CaptionWord } from '../../shared/caption-words';
import type { Db } from './database';

/* The admin's words left out of captions in the library (alpha.24, migration 094). Red first: not written yet. */
export class CaptionCleanWordsRepo {
  constructor(private readonly db: Db) {}

  get(): CaptionWord[] {
    void this.db;
    return [];
  }

  set(words: readonly CaptionWord[]): void {
    void words;
  }
}
