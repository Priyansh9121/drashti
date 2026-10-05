/*
 * Searching the library (PLAN.md 4.3): by title and slide text, in English,
 * Gujarati, Hindi and transliteration. Text is folded the same way for the
 * index and for what the operator types: Latin accents go ("namuna" finds
 * "Namūnā"), letters are lower-cased, and Gujarati and Devanagari vowel
 * signs and viramas stay part of their words. Transliteration is spelt
 * many ways, so (Session 13) v and w are one letter, and a doubled vowel is
 * its single one ("aa" as "a", "ee" as "i", "oo" as "u"): "dvitiyah" finds
 * "dwitiyah", and "Shree" finds "Shri". Both sides fold alike, so English
 * words still find themselves ("week" is "vik" on both).
 */

/** Latin accents are the combining marks U+0300 to U+036F once a text is decomposed. */
const LATIN_ACCENTS = /[̀-ͯ]/g;
/** Zero-width joiners change how Indic text is drawn, not what it says. */
const JOINERS = /[‌‍]/g;
/** A word: letters, their marks (Indic vowel signs are marks) and digits. */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/** Spellings of one sound in Latin letters, once lower-cased: v and w, and doubled (long) vowels. */
const SPELLINGS: readonly [RegExp, string][] = [
  [/w/g, 'v'],
  [/aa+/g, 'a'],
  [/ee+/g, 'i'],
  [/ii+/g, 'i'],
  [/oo+/g, 'u'],
  [/uu+/g, 'u'],
];

export function foldText(text: string): string {
  let folded = text
    .normalize('NFD')
    .replace(LATIN_ACCENTS, '')
    .normalize('NFC')
    .replace(JOINERS, '')
    .toLowerCase();
  for (const [spelling, as] of SPELLINGS) folded = folded.replace(spelling, as);
  return folded;
}

/** The folded words of a text, in order. */
export function searchWords(text: string): string[] {
  return foldText(text).match(WORD) ?? [];
}

/**
 * The full-text query for what the operator typed: every word must be
 * there, each as the start of a word ("nam" finds "Namūnā"). Null when
 * there is nothing to look for.
 */
export function ftsQuery(input: string): string | null {
  const words = searchWords(input).slice(0, 12);
  if (words.length === 0) return null;
  // Words hold only letters, marks and digits, so quoting them is enough.
  return words.map((w) => `"${w}"*`).join(' ');
}

/** Whether every query word starts one of a text's words. */
export function matchesAll(queryWords: readonly string[], textWords: readonly string[]): boolean {
  return queryWords.every((q) => textWords.some((w) => w.startsWith(q)));
}

/** The kirtan details search reads. */
export type KirtanField = 'kavi' | 'raag' | 'category' | 'occasion';

export interface SearchHit {
  presentationId: string;
  name: string;
  libraryName: string;
  /** Where it matched: the title, a kirtan's detail (its kavi, raag...), or a line of slide text as it is written. */
  match:
    | { kind: 'title' }
    | { kind: 'detail'; field: KirtanField; value: string }
    | { kind: 'text'; line: string; slideId: string };
}

export interface SearchResult {
  /** What was searched for, so a slow answer to an older query can be ignored. */
  query: string;
  hits: SearchHit[];
  /** More presentations matched than are listed. */
  more: boolean;
  /** Presentations with slide text in legacy fonts, which search cannot read yet. */
  legacyCount: number;
}

/** How many results a search lists. */
export const SEARCH_LIMIT = 50;
