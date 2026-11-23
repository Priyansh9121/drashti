import type { PDFPageProxy } from 'pdfjs-dist';

type Items = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'];
export type PdfWordItem = Extract<Items[number], { str: string }>;

function matrixOf(values: readonly unknown[]): number[] | undefined {
  const matrix: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    matrix.push(value);
  }
  return matrix.length === 6 ? matrix : undefined;
}

/** Match a paint operation even when PDF.js splits its phrase into words and spaces. */
export function pdfTextSpan(
  items: Items,
  words: string,
  used: ReadonlySet<number>,
): { item: PdfWordItem; indices: number[] } | undefined {
  for (const [start, first] of items.entries()) {
    if (used.has(start) || !('str' in first) || !words.startsWith(first.str)) continue;
    const firstMatrix = matrixOf(first.transform);
    if (!firstMatrix) continue;
    if (first.str === words) return { item: first, indices: [start] };
    if (first.dir !== 'ltr') continue;
    const size = Math.hypot(firstMatrix[2] ?? 0, firstMatrix[3] ?? 0);
    if (!size || Math.abs(firstMatrix[1] ?? 0) > 0.001 || Math.abs(firstMatrix[2] ?? 0) > 0.001) continue;
    let text = first.str;
    let previous = first;
    let previousMatrix = firstMatrix;
    const indices = [start];
    for (let index = start + 1; index < items.length; index++) {
      const next = items[index];
      if (
        used.has(index) ||
        !next ||
        !('str' in next) ||
        previous.hasEOL ||
        next.fontName !== first.fontName ||
        next.dir !== first.dir
      )
        break;
      const nextMatrix = matrixOf(next.transform);
      if (
        !nextMatrix ||
        nextMatrix.slice(0, 4).some((value, at) => Math.abs(value - (firstMatrix[at] ?? 0)) > 0.001) ||
        Math.abs((nextMatrix[5] ?? 0) - (firstMatrix[5] ?? 0)) > size * 0.02
      )
        break;
      const gap = (nextMatrix[4] ?? 0) - (previousMatrix[4] ?? 0) - previous.width;
      if (gap < -size * 0.1 || gap > size * 0.5) break;
      text += next.str;
      if (!words.startsWith(text)) break;
      indices.push(index);
      if (text === words)
        return {
          item: {
            ...first,
            str: text,
            width: (nextMatrix[4] ?? 0) + next.width - (firstMatrix[4] ?? 0),
            hasEOL: next.hasEOL,
          },
          indices,
        };
      previous = next;
      previousMatrix = nextMatrix;
    }
  }
  return undefined;
}
