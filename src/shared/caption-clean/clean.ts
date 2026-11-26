/*
 * Bad words left out of captions (alpha.24, QA24-CAPCLEAN-1). Red first: not written yet.
 */

/** At most this many words in one entry. */
export const CAPTION_CLEAN_PARTS = 3;

/** Whether a key (shared/caption-clean/key.ts) is on a list. */
export type CleanLookup = (key: string) => boolean;

export interface CleanedWords {
  kept: { from: number; text: string }[];
  left: number;
}

export function cleanWords(words: readonly string[], bad: CleanLookup): CleanedWords {
  void bad;
  return { kept: words.map((text, from) => ({ from, text })), left: 0 };
}

export function cleanCaption(text: string, bad: CleanLookup): { text: string; left: number } {
  void bad;
  return { text, left: 0 };
}
