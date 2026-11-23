import { describe, expect, it } from 'vitest';
import { pdfPageSelection } from './pdf-page-selection';

describe('PDF page selection', () => {
  it('selects one-based ranges in document order without duplicate pages', () => {
    expect(pdfPageSelection('4, 1-2, 2', 5)).toEqual([0, 1, 3]);
    expect(pdfPageSelection(' 3 ', 3)).toEqual([2]);
  });
  it('rejects incomplete, backwards, fractional, empty and out-of-bounds choices', () => {
    for (const text of ['', '1,', '2-1', '0', '4', '1.5', '1--2', 'all', '1 2']) {
      expect(pdfPageSelection(text, 3), text).toBeNull();
    }
    expect(pdfPageSelection('1', 0)).toBeNull();
    expect(pdfPageSelection('1', 401)).toBeNull();
  });
});
