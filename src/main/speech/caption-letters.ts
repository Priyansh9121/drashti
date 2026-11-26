import { hasOwnLetters, inOwnScript, otherLetters } from '../../shared/language-letters';
import type { HeardWord, SpeechLanguage } from '../../shared/speech';

/*
 * A chosen speaker's language keeps its captions to its own letters (alpha.24, QA24-CAPLANG-1; the owner: "it goes
 * between hindi, english, gujarati and sanskrit on his own even if i pick gujarati as speaker's language").
 *
 * whisper.cpp is asked for that language alone, but its language token does not hold the decoder to the language's
 * letters: Gujarati is one of the languages it learnt least. On the committed Gujarati test speech
 * (tests/fixtures/captions/gu), today's model, asked for Gujarati, wrote "Counter No. 738" in Latin letters for
 * gu-14-f and part of gu-07-f's first word in Devanagari, and Drashti showed them as Gujarati captions. So, for a
 * chosen language:
 * - Gujarati and Devanagari letters, which Unicode lays out in parallel (shared/scripts.ts), are written in the
 *   language's own script, letter for letter: Gujarati's in Gujarati letters; Hindi's and Sanskrit's in Devanagari,
 *   as the engine writes Sanskrit (the screens show Sanskrit in Gujarati letters, captions-feed.ts); a letter with its
 *   nukta built in is mapped too (shared/language-letters.ts, review F1);
 * - a word with a letter of any other script (Latin while Gujarati, Hindi or Sanskrit is chosen; Gujarati or
 *   Devanagari while English is; Arabic's, and the rest) is left out;
 * - a piece that loses words so and keeps nothing in its language's own script is not shown at all (null): it was
 *   written in another language, and what is left of it is a number or a sign.
 * Digits, punctuation, dandas and joiners belong to every language. Nothing else changes: each word keeps its times
 * and confidence, and "as heard" is not passed through here (each piece is in the language it was written in).
 */

/**
 * The words of a piece heard in a chosen language, kept to its letters: the same array when nothing changes, the
 * words kept (some written in the language's own script) when some do, or null when the piece is not to be shown.
 */
export function keepToLetters(
  words: readonly HeardWord[],
  language: SpeechLanguage,
): readonly HeardWord[] | null {
  const kept: HeardWord[] = [];
  let changed = false;
  let leftOut = 0;
  let ownKept = false;
  for (const word of words) {
    const text = inOwnScript(word.text, language);
    if (otherLetters(text, language) !== null) {
      leftOut += 1;
      changed = true;
      continue;
    }
    if (hasOwnLetters(text, language)) ownKept = true;
    if (text === word.text) kept.push(word);
    else {
      kept.push({ ...word, text });
      changed = true;
    }
  }
  if (leftOut > 0 && !ownKept) return null;
  return changed ? kept : words;
}
