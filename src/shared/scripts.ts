/*
 * Sanskrit in either of its scripts (Session 12). Devanagari and Gujarati
 * lay their letters out in parallel: Unicode puts each Gujarati letter 0x180
 * after its Devanagari one. So Sanskrit written in one script can be written
 * in the other letter for letter, which is how a Shastra text loaded in one
 * script is shown to a screen group that reads the other. The dandas (। ॥)
 * belong to both scripts, and the few signs one script lacks stay as they
 * are.
 */

const DEVANAGARI = 0x900;
const GUJARATI = 0xa80;
const OFFSET = GUJARATI - DEVANAGARI;

/** The Gujarati block's letters and signs that have a Devanagari twin at the same place. */
const GUJARATI_TWINS: readonly (readonly [number, number])[] = [
  [0xa81, 0xa83],
  [0xa85, 0xa8d],
  [0xa8f, 0xa91],
  [0xa93, 0xaa8],
  [0xaaa, 0xab0],
  [0xab2, 0xab3],
  [0xab5, 0xab9],
  [0xabc, 0xac5],
  [0xac7, 0xac9],
  [0xacb, 0xacd],
  [0xad0, 0xad0],
  [0xae0, 0xae3],
  [0xae6, 0xaf0],
];

const twin = (gujarati: number): boolean => GUJARATI_TWINS.some(([a, b]) => gujarati >= a && gujarati <= b);

/** The text with its Devanagari letters in Gujarati script (anything else as it is). */
export function toGujaratiScript(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const g = cp + OFFSET;
    out += cp >= DEVANAGARI && cp <= 0x97f && twin(g) ? String.fromCodePoint(g) : ch;
  }
  return out;
}

/** The text with its Gujarati letters in Devanagari (anything else as it is). */
export function toDevanagari(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    out += cp >= GUJARATI && cp <= 0xaff && twin(cp) ? String.fromCodePoint(cp - OFFSET) : ch;
  }
  return out;
}
