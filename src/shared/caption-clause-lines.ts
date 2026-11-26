import { captionLines } from './captions';

/** Source preview roll-up only: wrap a long token between complete graphemes, never inside a vowel cluster. */
export function captionClauseLines(text: string, max: number): string[] {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  const words = text.split(/\s+/u).flatMap((word) => {
    const pieces: string[] = [];
    let piece = '';
    let length = 0;
    for (const { segment } of segmenter.segment(word)) {
      const size = Array.from(segment).length;
      if (length > 0 && length + size > max) {
        pieces.push(piece);
        piece = '';
        length = 0;
      }
      piece += segment;
      length += size;
    }
    if (piece) pieces.push(piece);
    return pieces;
  });
  return captionLines(words, max);
}

/** A translation must fit whole, otherwise it is omitted, never silently shortened. */
export function captionTranslationLines(text: string, max: number): string[] | null {
  const words = text.trim().split(/\s+/u);
  if (words.some((word) => Array.from(word).length > max)) return null;
  const lines = captionLines(words, max, Number.MAX_SAFE_INTEGER);
  return lines.length <= 2 ? lines : null;
}

/**
 * A translation as two-line pages, in turn (alpha.24, QA24-CAPLANG-2, the owner's 2b: long translations as pages, not
 * dropped): whole words, every word kept, at most two lines a page. Null only when a word is wider than a line (or
 * there is nothing to show): that translation cannot be shown and is skipped.
 */
export function captionTranslationPages(text: string, max: number): string[][] | null {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  if (words.length === 0 || words.some((word) => Array.from(word).length > max)) return null;
  const lines = captionLines(words, max, Number.MAX_SAFE_INTEGER);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
  return pages;
}
