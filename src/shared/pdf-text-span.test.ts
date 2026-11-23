import { describe, expect, it } from 'vitest';
import { pdfTextSpan, type PdfWordItem } from './pdf-text-span';
const item = (str: string, x: number, width: number, y = 180): PdfWordItem => ({
  str,
  dir: 'ltr',
  width,
  height: 18,
  transform: [18, 0, 0, 18, x, y],
  fontName: 'placeholder-subset',
  hasEOL: false,
});
describe('PDF paint text matched to split extraction items', () => {
  it('recovers one painted phrase split at spaces, with exact source geometry', () => {
    const items = [item('Placeholder', 20, 110), item(' ', 130, 8), item('source', 138, 60)];
    expect(pdfTextSpan(items, 'Placeholder source', new Set())).toMatchObject({
      item: { str: 'Placeholder source', width: 178, transform: [18, 0, 0, 18, 20, 180] },
      indices: [0, 1, 2],
    });
  });
  it('does not reuse consumed source items and matches a later duplicate', () => {
    expect(
      pdfTextSpan(
        [item('Placeholder', 20, 110), item('Placeholder', 20, 110, 160)],
        'Placeholder',
        new Set([0]),
      )?.indices,
    ).toEqual([1]);
  });
  it('does not cross lines, columns, fonts or consumed items', () => {
    for (const next of [
      item('source', 130, 60, 160),
      item('source', 300, 60),
      { ...item('source', 130, 60), fontName: 'another-font' },
    ]) {
      expect(
        pdfTextSpan([item('Placeholder ', 20, 110), next], 'Placeholder source', new Set()),
      ).toBeUndefined();
    }
    expect(
      pdfTextSpan(
        [item('Placeholder ', 20, 110), item('source', 130, 60)],
        'Placeholder source',
        new Set([1]),
      ),
    ).toBeUndefined();
  });
});
