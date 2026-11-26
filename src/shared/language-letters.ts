import { toDevanagari, toGujaratiScript } from './scripts';
import type { SpeechLanguage } from './speech';

/*
 * Which letters a speaker's language is written in (alpha.24, QA24-CAPLANG-1): Gujarati in Gujarati letters, Hindi
 * in Devanagari, English in English (Latin) letters, and Sanskrit in either Indian script (the engine writes it in
 * Devanagari, the screens show it in Gujarati letters). Captions with a language chosen keep to its letters
 * (main/speech/caption-letters.ts), the engine is given only caption words in them as hints
 * (main/speech/caption-hints.ts), and the Caption Words dialog says when an entry is typed in other letters.
 * Digits, punctuation, dandas, joiners and the signs of no one script belong to every language.
 */

/** The scripts told apart, by the names the dialog gives them. */
export type LetterScript = 'Gujarati' | 'Devanagari' | 'English' | 'other';

const GUJARATI = /\p{Script=Gujarati}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const LATIN = /\p{Script=Latin}/u;
const LETTER = /[\p{L}\p{M}]/u;
/** Letters and marks of no one script (a combining accent, a Vedic sign). */
const SHARED = /[\p{Script=Common}\p{Script=Inherited}]/u;

/** Each language's own scripts. */
const OWN: Readonly<Record<SpeechLanguage, readonly LetterScript[]>> = {
  gu: ['Gujarati'],
  hi: ['Devanagari'],
  sa: ['Devanagari', 'Gujarati'],
  en: ['English'],
};

/** A character's script among those told apart (a letter, a sign or a digit of it), or 'other'. */
const scriptOf = (ch: string): LetterScript =>
  GUJARATI.test(ch) ? 'Gujarati' : DEVANAGARI.test(ch) ? 'Devanagari' : LATIN.test(ch) ? 'English' : 'other';

/**
 * The first script among the text's letters (and their signs) that is not one of the language's own, or null when
 * there is none. Digits are in every language, as are the letters and signs of no one script.
 */
export function otherLetters(text: string, language: SpeechLanguage): LetterScript | null {
  const own = OWN[language];
  for (const ch of text) {
    if (!LETTER.test(ch) || SHARED.test(ch)) continue;
    const script = scriptOf(ch);
    if (!own.includes(script)) return script;
  }
  return null;
}

/** Whether the text has a letter, a sign or a digit of one of the language's own scripts. */
export function hasOwnLetters(text: string, language: SpeechLanguage): boolean {
  const own = OWN[language];
  for (const ch of text) if (own.includes(scriptOf(ch))) return true;
  return false;
}

/**
 * The text with the letters Gujarati and Devanagari share written in the language's own script, letter for letter
 * (shared/scripts.ts): Gujarati's in Gujarati letters, Hindi's and Sanskrit's in Devanagari; English's as it is.
 * Taken apart first (NFD), so a Devanagari letter written with its nukta built in (क़, ज़, ड़, ऩ, ऱ, ऴ…) is mapped too
 * (review F1), and put together again as NFC writes it.
 */
export function inOwnScript(text: string, language: SpeechLanguage): string {
  if (language === 'gu') return toGujaratiScript(text.normalize('NFD')).normalize('NFC');
  if (language === 'hi' || language === 'sa') return toDevanagari(text.normalize('NFD')).normalize('NFC');
  return text;
}
