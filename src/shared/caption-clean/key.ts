/*
 * The key a caption's word is compared by when bad words are left out (alpha.24, QA24-CAPCLEAN-1). Red first: not
 * written yet.
 */

/** Drashti's own list holds SHA-256 of this, then a key (never a word): scripts/caption-clean-hash.mjs. */
export const CAPTION_CLEAN_HASH_PREFIX = 'drashti caption clean 1:';

/** A word's key. */
export function cleanKey(word: string): string {
  return word;
}

/** A word's marks around it, and the word itself. */
export function pieceOf(text: string): { lead: string; core: string; trail: string } {
  return { lead: '', core: text, trail: '' };
}

/** A phrase's key: its words' keys, one space between. */
export function cleanPhraseKey(text: string): string {
  return text;
}
