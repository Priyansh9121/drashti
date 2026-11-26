export type HashLanguage = 'gu' | 'hi' | 'sa' | 'en';
export interface HashWord {
  language: HashLanguage;
  word: string;
}
export type HashLists = Record<HashLanguage, string[]>;
/** SHA-256 of Drashti's prefix and the word's key (shared/caption-clean/key.ts), as the captions look it up. */
export function hashWord(word: string): string;
/** A words file: a language and a word a line; the lines it cannot read by number only. */
export function readWords(text: string): { words: HashWord[]; problems: number[] };
/** src/shared/caption-clean/list.ts for these lists, as prettier keeps it. */
export function listSource(lists: Readonly<Record<HashLanguage, readonly string[]>>): string;
/** The lists in a list file. */
export function readLists(source: string): HashLists;
/** The list file with these words' hashes added or removed, and how many changed. */
export function updateList(
  source: string,
  words: readonly HashWord[],
  mode: 'add' | 'remove',
): { source: string; counts: { changed: number; unchanged: number } };
/** The command: what it says (counts only, never a word). */
export function runHash(
  args: readonly string[],
  io: { read(path: string): string; write(path: string, text: string): void },
  listFile: string,
): string[];
