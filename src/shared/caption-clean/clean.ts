import { cleanKey, pieceOf } from './key';

/*
 * Bad words left out of captions (alpha.24, QA24-CAPCLEAN-1; the owner: "sensor bad words accross all 4 languages.
 * do not show them"). A word on a list is simply left out: no asterisks, no dots. Whole words only, compared by
 * their keys (key.ts), so a clean word that holds a bad one is never cut; an entry of two or three words is left
 * out only as those words together, with nothing but spaces between them. A word whose part (between hyphens,
 * apostrophes, a slash, or a sentence’s marks with no space after them: review F1) is a listed word is left out
 * whole. The marks around a word go with it, but a sentence’s
 * closing mark (. ? ! । ॥) moves onto the word before. Pure: the lists are the caller’s (CleanLookup), and nothing
 * here keeps or says a word.
 */

/** At most this many words in one entry (as a caption word: shared/caption-words.ts). */
export const CAPTION_CLEAN_PARTS = 3;

/** Whether a key (key.ts; an entry of several words: their keys, one space between) is on a list. */
export type CleanLookup = (key: string) => boolean;

/** The words that stay, each by its place in what was given, its text with any closing mark moved onto it. */
export interface CleanedWords {
  kept: { from: number; text: string }[];
  /** How many entries were left out. */
  left: number;
}

const PARTS = /[-\u2010-\u2015'\u2018\u2019\u02bc/_,;:.!?\u0964\u0965]+/u;
const CLOSING = /[.?!\u0964\u0965]+$/u;
/** A pause before a closing mark moved onto its word: the closing mark takes its place. */
const PAUSE = /[,;:]+$/u;

/** A word’s parts between hyphens, apostrophes, a slash or a sentence’s marks, when it has more than one. */
const partsOf = (core: string): string[] => core.split(PARTS).filter((p) => p !== '');

/** Which of these words are left out (true), and how many entries that was. */
function leftOut(words: readonly string[], bad: CleanLookup): { out: boolean[]; left: number } {
  const pieces = words.map(pieceOf);
  const keys = pieces.map((p) => (p.core === '' ? '' : cleanKey(p.core)));
  const out = words.map(() => false);
  let left = 0;
  let i = 0;
  while (i < words.length) {
    let used = 0;
    for (let k = Math.min(CAPTION_CLEAN_PARTS, words.length - i); k >= 1 && used === 0; k -= 1) {
      const window = pieces.slice(i, i + k);
      // Whole words only, with nothing but spaces between them.
      const whole = window.every(
        (p, j) => keys[i + j] !== '' && (j === k - 1 || p.trail === '') && (j === 0 || p.lead === ''),
      );
      if (!whole) continue;
      const key = keys.slice(i, i + k).join(' ');
      const piece = window[0];
      const found =
        bad(key) ||
        (k === 1 && piece !== undefined && partsOf(piece.core).length > 1
          ? partsOf(piece.core).some((part) => {
              const partKey = cleanKey(part);
              return partKey !== '' && bad(partKey);
            })
          : false);
      if (found) used = k;
    }
    if (used === 0) {
      i += 1;
      continue;
    }
    for (let j = i; j < i + used; j += 1) out[j] = true;
    left += 1;
    i += used;
  }
  return { out, left };
}

/** A phrase’s words with the bad ones left out, each word that stays by its place. */
export function cleanWords(words: readonly string[], bad: CleanLookup): CleanedWords {
  const { out, left } = leftOut(words, bad);
  const kept: { from: number; text: string }[] = [];
  words.forEach((text, from) => {
    if (!out[from]) {
      kept.push({ from, text });
      return;
    }
    // A sentence's closing mark stays, on the word before (in place of a comma there; never twice).
    const closing = CLOSING.exec(pieceOf(text).trail)?.[0];
    const before = kept.at(-1);
    if (closing && before && !CLOSING.test(before.text))
      before.text = `${before.text.replace(PAUSE, '')}${closing}`;
  });
  return { kept, left };
}

/** A caption’s text with the bad words left out, one space between the words that stay; as given when none is. */
export function cleanCaption(text: string, bad: CleanLookup): { text: string; left: number } {
  const words = text.split(/\s+/u).filter((w) => w !== '');
  const cleaned = cleanWords(words, bad);
  if (cleaned.left === 0) return { text, left: 0 };
  return { text: cleaned.kept.map((w) => w.text).join(' '), left: cleaned.left };
}
