import type { CaptionWord } from '../../shared/caption-words';
import { toDevanagari } from '../../shared/scripts';
import { SPEECH_LANGUAGES, type SpeechLanguage } from '../../shared/speech';

/*
 * What the captions engine is given to listen for (alpha.22): the first of the admin's caption words for the
 * language it listens in, as words (for an engine biased by a word list) and as one short prompt (whisper.cpp's
 * initial prompt, which nudges its spelling towards these words). This is the interface an engine calls: read at
 * each piece it sends, worked out again only when the list changes.
 *
 * Capped so it never slows recognition: the prompt is at most 200 bytes of UTF-8. Whisper's tokens are byte pairs,
 * never more than one a byte, so that is at most 200 tokens: below whisper.cpp's own limit (224, half its text
 * window; it would silently keep only the last ones), and a short prefix for the decoder next to the encoder's
 * fixed 30 s window. About 60 Gujarati or Devanagari letters (three bytes each), or 200 English ones. At most 50
 * words. Whole words only, from the start of the list, up to the first that does not fit.
 *
 * None for "as heard" (the engine chooses the language phrase by phrase: one language's words would push the others'
 * spelling towards its letters), and none when the list has no words for the language: then nothing is sent.
 * Sanskrit's words go in Devanagari, as the engine writes Sanskrit (the screens show it in Gujarati letters).
 */

export const HINT_PROMPT_BYTES = 200;
export const HINT_WORDS = 50;

export interface Hints {
  words: readonly string[];
  /** '' when there are none. */
  prompt: string;
}

/** The interface the captions engine calls (whisper-engine.ts; the next engines too). */
export interface CaptionHints {
  /** The hints for the language the engine listens in. */
  for(language: SpeechLanguage | 'auto'): Hints;
  /** How many of each language's words are in its prompt (the Caption Words dialog says so). */
  hinted(): Record<SpeechLanguage, number>;
}

const NONE: Hints = Object.freeze({ words: Object.freeze([]), prompt: '' });
const bytesOf = (text: string): number => Buffer.byteLength(text, 'utf8');

export function hintsOf(words: readonly CaptionWord[], language: SpeechLanguage | 'auto'): Hints {
  if (language === 'auto') return NONE;
  const mine = words
    .filter((w) => w.language === language)
    .slice(0, HINT_WORDS)
    .map((w) => (language === 'sa' ? toDevanagari(w.word) : w.word));
  if (mine.length === 0) return NONE;
  let prompt = '';
  for (const word of mine) {
    const next = prompt === '' ? word : `${prompt}, ${word}`;
    if (bytesOf(next) > HINT_PROMPT_BYTES) break;
    prompt = next;
  }
  return Object.freeze({ words: Object.freeze(mine), prompt });
}

/** Hints from the list as it is now (`list()` is read each time; its answer is worked out again when it changes). */
export function createCaptionHints(list: () => readonly CaptionWord[]): CaptionHints {
  let seen: readonly CaptionWord[] | null = null;
  let cache = new Map<SpeechLanguage | 'auto', Hints>();
  const now = (): readonly CaptionWord[] => {
    const words = list();
    if (words !== seen) {
      seen = words;
      cache = new Map();
    }
    return words;
  };
  const hints = (language: SpeechLanguage | 'auto'): Hints => {
    const words = now();
    let h = cache.get(language);
    if (!h) {
      h = hintsOf(words, language);
      cache.set(language, h);
    }
    return h;
  };
  return {
    for: hints,
    hinted() {
      const counts = {} as Record<SpeechLanguage, number>;
      for (const language of SPEECH_LANGUAGES) {
        const prompt = hints(language).prompt;
        counts[language] = prompt === '' ? 0 : prompt.split(', ').length;
      }
      return counts;
    },
  };
}
