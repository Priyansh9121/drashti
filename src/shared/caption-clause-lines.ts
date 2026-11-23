import { captionLines } from './captions';

/** Fit a clause without breaking a writing system's grapheme clusters. */
export function captionClauseLines(text: string, max: number): string[] {
  return captionLines(text.split(/\s+/u), max);
}
