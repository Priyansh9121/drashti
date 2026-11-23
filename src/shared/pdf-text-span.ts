import type { PDFPageProxy } from 'pdfjs-dist';

type Items = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'];
export type PdfWordItem = Extract<Items[number], { str: string }>;

/** Match a paint operation even when PDF.js splits its phrase into words and spaces. */
export function pdfTextSpan(
  items: Items,
  words: string,
  used: ReadonlySet<number>,
): { item: PdfWordItem; indices: number[] } | undefined {
  for (const [start, first] of items.entries()) {
    if (used.has(start) || !('str' in first) || !words.startsWith(first.str)) continue;
    if (first.str === words) return { item: first, indices: [start] };
    if (first.dir !== 'ltr') continue;
    const size = Math.hypot(first.transform[2] ?? 0, first.transform[3] ?? 0);
    if (!size || Math.abs(first.transform[1] ?? 0) > 0.001 || Math.abs(first.transform[2] ?? 0) > 0.001)
      continue;
    let text = first.str;
    let previous = first;
    const indices = [start];
    for (let index = start + 1; index < items.length; index++) {
      const next = items[index];
      if (
        used.has(index) ||
        !next ||
        !('str' in next) ||
        previous.hasEOL ||
        next.fontName !== first.fontName ||
        next.dir !== first.dir ||
        next.transform
          .slice(0, 4)
          .some((value, at) => Math.abs(value - (first.transform[at] ?? 0)) > 0.001) ||
        Math.abs((next.transform[5] ?? 0) - (first.transform[5] ?? 0)) > size * 0.02
      )
        break;
      const gap = (next.transform[4] ?? 0) - (previous.transform[4] ?? 0) - previous.width;
      if (gap < -size * 0.1 || gap > size * 0.5) break;
      text += next.str;
      if (!words.startsWith(text)) break;
      indices.push(index);
      if (text === words)
        return {
          item: {
            ...first,
            str: text,
            width: (next.transform[4] ?? 0) + next.width - (first.transform[4] ?? 0),
            hasEOL: next.hasEOL,
          },
          indices,
        };
      previous = next;
    }
  }
  return undefined;
}
