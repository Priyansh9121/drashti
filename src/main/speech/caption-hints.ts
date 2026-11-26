import { CAPTION_HINTS_ON, type CaptionWord } from '../../shared/caption-words';
import { otherLetters } from '../../shared/language-letters';
import { toDevanagari } from '../../shared/scripts';
import { SPEECH_LANGUAGES, type SpeechLanguage } from '../../shared/speech';

/*
 * What the captions engine is given to listen for (alpha.22): the first of the admin's caption words for the
 * language it listens in, as words (for an engine biased by a word list) and as one short prompt (whisper.cpp's
 * initial prompt, which nudges its spelling towards these words). This is the interface an engine calls: read at
 * each piece it sends, worked out again only when the list changes.
 *
 * Capped by whisper's tokens, about 220 at most: below whisper.cpp's own limit (224, half its text window; past it,
 * it silently keeps only the last ones), and a short prefix for the decoder next to the encoder's fixed 30 s
 * window, so it never slows recognition. There is no tokenizer here, so the count is an estimate that is never
 * below what cap-drive-learn measured on whisper's own tokenizer (23 Nov: Gujarati about one token a byte, Hindi
 * one in 2.4 bytes, English one in 2.3; N/reports/cap-drive-learn.md): about 70 Gujarati letters fit, 140 Hindi
 * ones or 400 English ones. At most 50 words, and never more than 1,000 bytes. Whole words only, from the start of
 * the list, up to the first that does not fit; written with the first caption word last, so that were the
 * estimate ever short, whisper.cpp would cut the least important ones.
 *
 * None for "as heard" (the engine chooses the language phrase by phrase: one language's words would push the others'
 * spelling towards its letters), and none when the list has no words for the language: then nothing is sent.
 * Sanskrit's words go in Devanagari, as the engine writes Sanskrit (the screens show it in Gujarati letters). An
 * entry typed in other letters than its language's (a name in English letters under Gujarati) is never given
 * (alpha.24, shared/language-letters.ts).
 */

export const HINT_PROMPT_TOKENS = 220;
export const HINT_WORDS = 50;
/** A second bound: never more than this many bytes of UTF-8 (drashti-whisper.c reads up to 1,023). */
export const HINT_PROMPT_MAX_BYTES = 1_000;

/**
 * About how many of whisper's tokens a text costs, never fewer than measured: a Gujarati letter three (one a byte),
 * a Devanagari letter one and a half, any other letter outside ASCII one a byte, an English letter or digit a half,
 * a space none (it goes with the word after it), any other sign one.
 */
export function promptTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0a80 && cp <= 0x0aff) tokens += 3;
    else if (cp >= 0x0900 && cp <= 0x097f) tokens += 1.5;
    else if (cp > 0x7f) tokens += Buffer.byteLength(ch, 'utf8');
    else if (/[A-Za-z0-9]/u.test(ch)) tokens += 0.5;
    else if (ch !== ' ') tokens += 1;
  }
  return Math.ceil(tokens);
}

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
    // Only entries in the language's own letters (review F2): with a language chosen, captions keep to its letters, so
    // another's never shows, and in the prompt it would push the engine towards letters that are left out.
    .filter((w) => w.language === language && otherLetters(w.word, language) === null)
    .slice(0, HINT_WORDS)
    .map((w) => (language === 'sa' ? toDevanagari(w.word) : w.word));
  if (mine.length === 0) return NONE;
  let prompt = '';
  for (const word of mine) {
    const next = prompt === '' ? word : `${word}, ${prompt}`;
    if (promptTokens(next) > HINT_PROMPT_TOKENS || bytesOf(next) > HINT_PROMPT_MAX_BYTES) break;
    prompt = next;
  }
  return Object.freeze({ words: Object.freeze(mine), prompt });
}

/** Hints from the list as it is now (`list()` is read each time; its answer is worked out again when it changes). */
export function createCaptionHints(
  list: () => readonly CaptionWord[],
  hintsOn: () => Readonly<Record<SpeechLanguage, boolean>> = () => CAPTION_HINTS_ON,
): CaptionHints {
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
    // The language's switch (Gujarati off until the admin turns it on): read at each piece, never cached.
    if (language !== 'auto' && !hintsOn()[language]) return NONE;
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
