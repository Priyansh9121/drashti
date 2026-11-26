import { checkCaptionWord, isCaptionLanguage, type CaptionWord } from '../caption-words';
import type { SpeechLanguage } from '../speech';
import { cleanPhraseKey } from './key';

/*
 * Words left out of captions (alpha.24, QA24-CAPCLEAN-1): besides Drashti's own list (shared/caption-clean/list.ts,
 * kept as hashes, never as words), the admin's own words per language, kept in the library (migration 094) as
 * Caption Words are: File › Live Captions… › Words Left Out…, Pro Mode. Each entry is a word, or two or three words
 * left out only together, checked as a caption word is (shared/caption-words.ts). The same file as Caption Words'
 * for Import… and Export…. Every caption is checked against every language's words.
 */

/** At most this many of the admin's words a language. */
export const CAPTION_CLEAN_WORDS_PER_LANGUAGE = 200;

/** What the Words Left Out dialog and the Live Captions dialog show. */
export interface CaptionCleanView {
  /** The admin's own words, in each language's order. */
  words: CaptionWord[];
  /** How many words Drashti's own list has, per language (never the words). */
  own: Record<SpeechLanguage, number>;
  /** How many words captions have left out since they were last turned on. */
  leftOut: number;
}

/** What the operator window is told as captions leave words out: a number, never a word. */
export interface CaptionCleanCount {
  leftOut: number;
}

/** A change's answer: the view as it is now, and a sentence for the admin (what an import added, or why not). */
export interface CaptionCleanResult {
  ok: boolean;
  view: CaptionCleanView;
  message: string | null;
}

/** Words added to the admin's list: each at the end of its language's, unless there already (by key) or full. */
export function addCleanWords(
  list: readonly CaptionWord[],
  added: readonly CaptionWord[],
): { words: CaptionWord[]; added: number; already: number; full: number } {
  const words = [...list];
  const keys = new Set(words.map((w) => `${w.language}:${cleanPhraseKey(w.word)}`));
  const counts = new Map<SpeechLanguage, number>();
  for (const w of words) counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
  let addedCount = 0;
  let already = 0;
  let full = 0;
  for (const w of added) {
    const key = `${w.language}:${cleanPhraseKey(w.word)}`;
    if (keys.has(key)) already += 1;
    else if ((counts.get(w.language) ?? 0) >= CAPTION_CLEAN_WORDS_PER_LANGUAGE) full += 1;
    else {
      keys.add(key);
      counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
      words.push({ language: w.language, word: w.word });
      addedCount += 1;
    }
  }
  return { words, added: addedCount, already, full };
}

/** The admin's list as stored or sent: each entry checked, repeats and anything past 200 a language left out. */
export function parseCleanWords(raw: unknown): CaptionWord[] {
  if (!Array.isArray(raw)) return [];
  const checked: CaptionWord[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const fields = item as Record<string, unknown>;
    const language = fields['language'];
    const word = fields['word'];
    if (!isCaptionLanguage(language) || typeof word !== 'string') continue;
    const c = checkCaptionWord(word);
    if (c.ok) checked.push({ language, word: c.word });
  }
  return addCleanWords([], checked).words;
}
