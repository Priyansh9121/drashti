import type { SpeechLanguage } from './speech';

/* Caption words (alpha.22): red first, not written yet. */

export interface CaptionWord {
  language: SpeechLanguage;
  word: string;
}

export const CAPTION_WORDS_PER_LANGUAGE = 200;

export type CheckedCaptionWord = { ok: true; word: string } | { ok: false; message: string };

export function checkCaptionWord(text: string): CheckedCaptionWord {
  return { ok: true, word: text };
}

export function captionWordKey(text: string, _language: SpeechLanguage): string {
  return text;
}

export function parseCaptionWords(_raw: unknown): CaptionWord[] {
  return [];
}

export function addCaptionWords(
  list: readonly CaptionWord[],
  _added: readonly CaptionWord[],
): { words: CaptionWord[]; added: number; already: number; full: number } {
  return { words: [...list], added: 0, already: 0, full: 0 };
}

export function captionWordsCsv(_words: readonly CaptionWord[]): string {
  return '';
}

export function readCaptionWordsCsv(_text: string): {
  words: CaptionWord[];
  problems: { line: number; message: string }[];
} {
  return { words: [], problems: [] };
}
