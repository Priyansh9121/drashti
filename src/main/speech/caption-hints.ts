import type { CaptionWord } from '../../shared/caption-words';
import type { SpeechLanguage } from '../../shared/speech';

/* What the captions engine is given to listen for (alpha.22): red first, not written yet. */

export const HINT_PROMPT_BYTES = 200;
export const HINT_WORDS = 50;

export interface Hints {
  words: readonly string[];
  prompt: string;
}

export interface CaptionHints {
  for(language: SpeechLanguage | 'auto'): Hints;
  hinted(): Record<SpeechLanguage, number>;
}

export function hintsOf(_words: readonly CaptionWord[], _language: SpeechLanguage | 'auto'): Hints {
  return { words: [], prompt: '' };
}

export function createCaptionHints(_list: () => readonly CaptionWord[]): CaptionHints {
  return {
    for: () => ({ words: [], prompt: '' }),
    hinted: () => ({ gu: 0, hi: 0, sa: 0, en: 0 }),
  };
}
