import { CAPTION_WORD_LANGUAGE_NAMES, type CaptionWord } from '../../../shared/caption-words';
import { otherLetters } from '../../../shared/language-letters';
import type { SpeechLanguage } from '../../../shared/speech';
import { plural } from '../../../shared/text';

/* The Caption Words dialog's words (alpha.22). */

/**
 * The line under the list: how many words this language has, and how many of them the captions engine is given as
 * hints (the first ones, as many as its 200-byte prompt holds), or why none are now.
 */
export function captionWordsHintText(
  name: string,
  count: number,
  hinted: number,
  listening: SpeechLanguage | 'auto',
  language: SpeechLanguage,
  on = true,
): string {
  if (count === 0) return `No ${name} caption words yet.`;
  const words = plural(count, `${name} word`);
  if (listening === 'auto')
    return `${words}. With the language left as heard, spellings are fixed but the engine is given no hints.`;
  if (listening !== language) return `${words}, used when captions listen for ${name}.`;
  if (!on) return `${words}. Hints for the captions engine are off for ${name}; spellings are still fixed.`;
  if (count === 1) return `${words}, given to the captions engine as a hint.`;
  if (hinted >= count) return `${words}, all given to the captions engine as hints.`;
  return `${words}. The first ${String(hinted)} fit in the captions engine’s hints, so put the most important first; all of them fix spellings.`;
}

/** The letters each language's caption words are typed in, for the line under the list. */
const LETTERS: Readonly<Record<SpeechLanguage, string>> = {
  gu: 'Gujarati',
  hi: 'Devanagari',
  sa: 'Gujarati or Devanagari',
  en: 'English',
};

/**
 * The line under the list, from this language's entries (alpha.24, review R2-1): only those in the language's own
 * letters are counted, as only they are given as hints and show while it is chosen; with none in them, it says so.
 */
export function captionWordsLine(
  entries: readonly CaptionWord[],
  hinted: number,
  listening: SpeechLanguage | 'auto',
  language: SpeechLanguage,
  on = true,
): string {
  const name = CAPTION_WORD_LANGUAGE_NAMES[language];
  const count = entries.filter((w) => otherLetters(w.word, language) === null).length;
  if (count === 0 && entries.length > 0)
    return `No ${name} caption words in ${LETTERS[language]} letters yet.`;
  return captionWordsHintText(name, count, hinted, listening, language, on);
}

/**
 * Beside an entry under Gujarati, Hindi or Sanskrit typed in other letters than its language's (alpha.24, lead 2):
 * it is kept as typed, but captions with that language chosen keep to its letters, so it never shows then (as heard
 * is not kept to letters). Null for any other entry (English's too).
 */
export function captionWordLettersText(word: string, language: SpeechLanguage): string | null {
  if (language === 'en') return null;
  const other = otherLetters(word, language);
  if (other === null) return null;
  const name = CAPTION_WORD_LANGUAGE_NAMES[language];
  return `Typed in ${other} letters: it won’t show in ${name} captions while ${name} is chosen.`;
}
