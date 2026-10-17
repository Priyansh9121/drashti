/** "1 slide", "2 slides", "1,200 presentations": never "slide(s)" (Session 25). */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** Letters as people see them (a conjunct, a letter with its vowel sign or accent, an emoji): one each. */
const LETTERS =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/**
 * Words cut to at most `max` UTF-16 units, what a string's length and every limit in Drashti count, never
 * inside a letter (Sessions 31–36, I18N-5): a Gujarati or Hindi conjunct (ક્ષ, क्ष), a vowel sign, an accent
 * or an emoji is kept whole or left out whole. Words that fit come back as they are; `ending` (an ellipsis)
 * is added, inside the limit, only when something was cut.
 */
export function cutText(text: string, max: number, ending = ''): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - ending.length);
  if (!LETTERS) return `${cutByMarks(text, room)}${ending}`;
  let out = '';
  for (const { segment } of LETTERS.segment(text)) {
    if (out.length + segment.length > room) break;
    out += segment;
  }
  return `${out}${ending}`;
}

/** A mark that belongs to the letter before it: a vowel sign or accent, a virama, ZWJ or ZWNJ. */
const MARK = /^[\p{M}\u200c\u200d]$/u;
/** What ties the letter after it to the one before: a Devanagari or Gujarati virama, ZWJ or ZWNJ. */
const TIE = /^[\u094d\u0acd\u200c\u200d]$/u;

/**
 * cutText where a browser has no Intl.Segmenter (an older phone's): whole code points, then back to where
 * neither a mark after the cut nor a virama or joiner before it ties two letters together.
 */
export function cutByMarks(text: string, room: number): string {
  const points = Array.from(text);
  let n = 0;
  let length = 0;
  while (n < points.length && length + (points[n] ?? '').length <= room) {
    length += (points[n] ?? '').length;
    n += 1;
  }
  while (n > 0 && (MARK.test(points[n] ?? '') || TIE.test(points[n - 1] ?? ''))) n -= 1;
  return points.slice(0, n).join('');
}
