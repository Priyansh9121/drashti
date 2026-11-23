import type { PDFPageProxy } from 'pdfjs-dist';

type Items = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'];
export type PdfWordItem = Extract<Items[number], { str: string }>;
export function pdfTextSpan(
  _items: Items,
  _words: string,
  _used: ReadonlySet<number>,
): { item: PdfWordItem; indices: number[] } | undefined {
  return undefined;
}
