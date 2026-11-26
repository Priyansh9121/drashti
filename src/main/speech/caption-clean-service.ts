import type { CaptionWord } from '../../shared/caption-words';
import type { CaptionsShown } from '../../shared/captions';
import type {
  CaptionCleanCount,
  CaptionCleanResult,
  CaptionCleanView,
} from '../../shared/caption-clean/words';
import type { Heard, SpeechLanguage } from '../../shared/speech';

/* Words left out of captions (alpha.24, QA24-CAPCLEAN-1). Red first: not written yet. */

export type CaptionCleanList = Readonly<Record<SpeechLanguage, readonly string[]>>;

export interface CaptionCleanDeps {
  repo: { get(): CaptionWord[]; set(words: readonly CaptionWord[]): void };
  own?: CaptionCleanList;
  testWords?: readonly string[];
  hash?: (key: string) => string;
  pickImport: () => Promise<string | null>;
  pickExport: (defaultName: string) => Promise<string | null>;
  changed: (count: CaptionCleanCount) => void;
  log: { info(message: string): void; warn(message: string): void };
}

export function captionCleanHash(key: string): string {
  return key;
}

export class CaptionCleanService {
  constructor(private readonly deps: CaptionCleanDeps) {}

  heard(h: Heard): Heard {
    return h;
  }

  shown(captions: CaptionsShown | null): CaptionsShown | null {
    return captions;
  }

  captionsOn(on: boolean): void {
    void on;
  }

  view(): CaptionCleanView {
    return { words: this.deps.repo.get(), own: { gu: 0, hi: 0, sa: 0, en: 0 }, leftOut: 0 };
  }

  set(raw: unknown): CaptionCleanResult {
    void raw;
    return { ok: true, view: this.view(), message: null };
  }

  importFile(): Promise<CaptionCleanResult> {
    return Promise.resolve({ ok: true, view: this.view(), message: null });
  }

  exportFile(): Promise<CaptionCleanResult> {
    return Promise.resolve({ ok: true, view: this.view(), message: null });
  }
}
