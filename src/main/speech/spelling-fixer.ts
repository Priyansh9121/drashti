import { captionWordKey, CAPTION_WORD_PARTS, type CaptionWord } from '../../shared/caption-words';
import { toDevanagari } from '../../shared/scripts';
import type { Heard, HeardWord, SpeechLanguage } from '../../shared/speech';

/*
 * The spelling fixer after recognition (alpha.22): a word heard close to one of the admin's caption words is spelt
 * as written there, so a name the model half-knows shows as it should on the screens (and in a sound recording's
 * draft). Only in the phrase's own language, only whole words (or a caption word of two or three words, word for
 * word), and only when it is clearly that caption word:
 *
 * - Close means a few letters (code points) added, taken away or changed (Levenshtein distance). A speech model's
 *   misspelling of a name is mostly one vowel sign, one virama, a nukta or anusvara, or one consonant for its
 *   neighbour (aspirated for plain, retroflex for dental); each is one code point, and a Gujarati or Hindi syllable
 *   is about two, so one change in every four or five letters is one in about two syllables. A word of four letters
 *   or fewer is never changed (almost every short word is one change from another real word); five to eight
 *   letters allow one change, nine to thirteen two, and longer three. The word heard may be at most one letter
 *   longer or shorter.
 * - It is left as heard when it is the caption word with an ending (Gujarati joins endings to the word: the name
 *   and ને), when in Gujarati, Hindi or Sanskrit it differs only in its last vowel signs (an ending, not a
 *   misspelling), when two caption words are as close, when it is already another caption word, and when a
 *   capitalised English caption word (a name) meets a word heard without a capital.
 *
 * Punctuation around a word heard stays as heard; its times and confidence stay too. A phrase with nothing to fix
 * is passed on as it came (the same object). It never logs a word.
 */

interface Entry {
  parts: string[];
  /** As compared, in code points. */
  key: string[];
  keyText: string;
  /** Its stem as compared: without the vowel signs (or other marks) at its end. */
  stem: string;
  capital: boolean;
}

const INDIC: ReadonlySet<SpeechLanguage> = new Set(['gu', 'hi', 'sa']);
const EDGES = /^([^\p{L}\p{M}\p{N}]*)(.*?)([^\p{L}\p{M}\p{N}]*)$/su;
const TRAILING_MARKS = /\p{M}+$/u;
const CAPITAL = /^\p{Lu}/u;
const DEVANAGARI = /[ऀ-ॿ]/u;

/** How many changes a caption word of this many letters allows: none up to four, then one, two up to 13, three. */
export function allowedEdits(letters: number): number {
  if (letters <= 4) return 0;
  if (letters <= 8) return 1;
  if (letters <= 13) return 2;
  return 3;
}

/**
 * Levenshtein distance between two strings' code points, counted only up to `max`: anything further is max + 1.
 * Only the band of `max` either side of the diagonal is worked out.
 */
export function editDistance(a: readonly string[], b: readonly string[], max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const over = max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => (j <= max ? j : over));
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(over);
    row[0] = i <= max ? i : over;
    let best = row[0];
    const from = Math.max(1, i - max);
    const to = Math.min(b.length, i + max);
    for (let j = from; j <= to; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j - 1] ?? over) + cost,
        (previous[j] ?? over) + 1,
        (row[j - 1] ?? over) + 1,
      );
      row[j] = Math.min(over, value);
      best = Math.min(best, row[j] ?? over);
    }
    if (best > max) return over;
    previous = row;
  }
  return Math.min(over, previous[b.length] ?? over);
}

interface Piece {
  lead: string;
  core: string;
  trail: string;
}

const pieceOf = (text: string): Piece => {
  const m = EDGES.exec(text);
  return { lead: m?.[1] ?? '', core: m?.[2] ?? '', trail: m?.[3] ?? '' };
};

/** The caption word a stretch heard is, or null: by its key, its first letter's capital, in its language. */
function match(entries: readonly Entry[], heard: string, capital: boolean, indic: boolean): Entry | null {
  for (const e of entries) if (e.keyText === heard) return e.capital && !capital ? null : e;
  const letters = [...heard];
  const stem = heard.replace(TRAILING_MARKS, '');
  let best: Entry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tie = false;
  for (const e of entries) {
    const allowed = allowedEdits(e.key.length);
    if (allowed === 0 || Math.abs(letters.length - e.key.length) > 1) continue;
    // The caption word with an ending, or with another ending in place of its last vowel sign.
    if (heard.startsWith(e.keyText) || (indic && stem === e.stem)) continue;
    if (e.capital && !capital) continue;
    const distance = editDistance(letters, e.key, allowed);
    if (distance > allowed) continue;
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
      tie = false;
    } else if (distance === bestDistance) tie = true;
  }
  return tie ? null : best;
}

/** A fixer for this list: each phrase heard, with words close to a caption word of its language spelt as written. */
export function spellingFixer(words: readonly CaptionWord[]): (h: Heard) => Heard {
  // Each language's entries, by how many words they have.
  const lists = new Map<SpeechLanguage, Entry[][]>();
  for (const w of words) {
    const keyText = captionWordKey(w.word, w.language);
    const parts = w.word.split(' ');
    const entry: Entry = {
      parts,
      key: [...keyText],
      keyText,
      stem: keyText.replace(TRAILING_MARKS, ''),
      capital: CAPITAL.test(w.word),
    };
    const byParts = lists.get(w.language) ?? Array.from({ length: CAPTION_WORD_PARTS + 1 }, () => []);
    byParts[parts.length]?.push(entry);
    lists.set(w.language, byParts);
  }
  return (h) => {
    const byParts = lists.get(h.language);
    if (!byParts || h.words.length === 0) return h;
    const indic = INDIC.has(h.language);
    const pieces = h.words.map((w) => pieceOf(w.text));
    const out: HeardWord[] = [];
    let changed = false;
    let i = 0;
    while (i < h.words.length) {
      let used = 0;
      for (let k = Math.min(CAPTION_WORD_PARTS, h.words.length - i); k >= 1 && used === 0; k -= 1) {
        const entries = byParts[k] ?? [];
        if (entries.length === 0) continue;
        const window = pieces.slice(i, i + k);
        // Whole words only, with nothing but spaces between them.
        const whole = window.every(
          (p, j) => p.core !== '' && (j === k - 1 || p.trail === '') && (j === 0 || p.lead === ''),
        );
        if (!whole) continue;
        const heardText = window.map((p) => p.core).join(' ');
        const found = match(entries, captionWordKey(heardText, h.language), CAPITAL.test(heardText), indic);
        if (!found) continue;
        const devanagari = h.language === 'sa' && DEVANAGARI.test(heardText);
        for (let j = 0; j < k; j += 1) {
          const word = h.words[i + j];
          const p = window[j];
          if (!word || !p) continue;
          const part = found.parts[j] ?? '';
          const spelt = (devanagari ? toDevanagari(part) : part).normalize('NFC');
          const text = `${j === 0 ? p.lead : ''}${spelt}${j === k - 1 ? p.trail : ''}`;
          if (text !== word.text) changed = true;
          out.push(text === word.text ? word : { ...word, text });
        }
        used = k;
      }
      if (used === 0) {
        const word = h.words[i];
        if (word) out.push(word);
        used = 1;
      }
      i += used;
    }
    if (!changed) return h;
    return { ...h, words: out, text: out.map((w) => w.text).join(' ') };
  };
}
