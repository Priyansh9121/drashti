import { captionLines } from './captions';

/** Source preview roll-up only: wrap a long token between complete graphemes, never inside a vowel cluster. */
export function captionClauseLines(text: string, max: number): string[] {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  const words = text.split(/\s+/u).flatMap(word => {
    const pieces: string[] = [];
    let piece = '';
    let length = 0;
    for (const { segment } of segmenter.segment(word)) {
      const size = [...segment].length;
      if (length > 0 && length + size > max) { pieces.push(piece); piece = ''; length = 0; }
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
  if (words.some(word => [...word].length > max)) return null;
  const lines = captionLines(words, max, Number.MAX_SAFE_INTEGER);
  return lines.length <= 2 ? lines : null;
}
