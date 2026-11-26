/*
 * The key a caption's word is compared by when bad words are left out of captions (alpha.24, QA24-CAPCLEAN-1): two
 * spellings of one word have one key, so one entry on a list covers both.
 *
 * - Unicode decomposed (NFD), then composed again (NFC) at the end: a letter typed as one code point or as two is
 *   the same.
 * - Hidden signs (format characters: the joiners ZWJ and ZWNJ, a soft hyphen, a zero-width space) left out.
 * - Gujarati letters folded onto their Devanagari twins (Unicode lays the two scripts out in parallel, 0x180 apart),
 *   so Hindi, Sanskrit and Gujarati words match in either script (the screens show Sanskrit in Gujarati letters).
 * - The nukta left out (ज़ is ज, ड़ is ड); a chandrabindu taken as an anusvara (हँस, हंस); and a nasal with a virama
 *   before a consonant of its own class taken as an anusvara too (हिन्दी, हिंदी). Every other sign, a vowel sign
 *   above all, is kept: another ending is another word.
 * - Latin letters in lower case without accents, and one kind of apostrophe.
 *
 * Plain TypeScript with no imports, so scripts/caption-clean-hash.mjs runs this very file in Node to hash
 * Drashti’s own list by exactly these rules.
 */

/** Drashti’s own list holds SHA-256 of this, then a key (never a word): scripts/caption-clean-hash.mjs. */
export const CAPTION_CLEAN_HASH_PREFIX = 'drashti caption clean 1:';

const FORMAT = /\p{Cf}/gu;
const GUJARATI = /[\u0a80-\u0aff]/gu;
const NUKTA = /\u093c/gu;
const CHANDRABINDU = /\u0901/gu;
/** ङ ञ ण न म with a virama, before a consonant of its own class (velar, palatal, retroflex, dental, labial). */
const CLASS_NASAL =
  /\u0919\u094d(?=[\u0915-\u0918])|\u091e\u094d(?=[\u091a-\u091d])|\u0923\u094d(?=[\u091f-\u0922])|\u0928\u094d(?=[\u0924-\u0927])|\u092e\u094d(?=[\u092a-\u092d])/gu;
/** Latin accents, once decomposed. */
const ACCENTS = /[\u0300-\u036f]/gu;
const APOSTROPHES = /[\u2018\u2019\u02bc]/gu;

/** A word’s key (its marks around it already taken off: pieceOf). */
export function cleanKey(word: string): string {
  return word
    .normalize('NFD')
    .replace(FORMAT, '')
    .replace(GUJARATI, (ch) => String.fromCodePoint((ch.codePointAt(0) ?? 0) - 0x180))
    .replace(NUKTA, '')
    .replace(CHANDRABINDU, '\u0902')
    .replace(CLASS_NASAL, '\u0902')
    .replace(ACCENTS, '')
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .normalize('NFC');
}

const EDGES = /^([^\p{L}\p{M}\p{N}]*)(.*?)([^\p{L}\p{M}\p{N}]*)$/su;

/** A word as a caption has it: the marks before it, the word itself, and the marks after it. */
export function pieceOf(text: string): { lead: string; core: string; trail: string } {
  const m = EDGES.exec(text);
  return { lead: m?.[1] ?? '', core: m?.[2] ?? '', trail: m?.[3] ?? '' };
}

/** A phrase’s key: each word’s key, the marks around it taken off, one space between. */
export function cleanPhraseKey(text: string): string {
  return text
    .split(/\s+/u)
    .map((part) => cleanKey(pieceOf(part).core))
    .filter((key) => key !== '')
    .join(' ');
}
