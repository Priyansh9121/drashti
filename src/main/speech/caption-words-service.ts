import type { CaptionWord, CaptionWordsResult, CaptionWordsView } from '../../shared/caption-words';
import type { Heard } from '../../shared/speech';
import { createCaptionHints, type CaptionHints } from './caption-hints';

/* Caption words as the admin keeps them (alpha.22): red first, not written yet. */

export interface CaptionWordsDeps {
  repo: { get(): CaptionWord[]; set(words: readonly CaptionWord[]): void };
  pickImport: () => Promise<string | null>;
  pickExport: (defaultName: string) => Promise<string | null>;
  log: { info(message: string): void; warn(message: string): void };
}

export class CaptionWordsService {
  readonly hints: CaptionHints = createCaptionHints(() => []);

  constructor(private readonly deps: CaptionWordsDeps) {}

  view(): CaptionWordsView {
    return { words: [], hinted: this.hints.hinted() };
  }

  set(_raw: unknown): CaptionWordsResult {
    return { ok: true, view: this.view(), message: null };
  }

  importFile(): Promise<CaptionWordsResult> {
    return Promise.resolve({ ok: true, view: this.view(), message: null });
  }

  exportFile(): Promise<CaptionWordsResult> {
    void this.deps;
    return Promise.resolve({ ok: true, view: this.view(), message: null });
  }

  fix(h: Heard): Heard {
    return h;
  }
}
