import { describe, expect, it } from 'vitest';
import { pdfWordFont } from './pdf-word-font';

describe('editable PDF words use bundled script fonts', () => {
  it('keeps all bundled script fallbacks available after a Latin line with diacritics is edited', () => {
    expect(pdfWordFont('Placeholder āīū')).toEqual({ family: 'Noto Sans', lang: 'en' });
  });
  it('uses Gujarati Noto for a newly typed letter absent from a source subset', () => {
    expect(pdfWordFont('કખગઘઙ')).toEqual({ family: 'Noto Sans Gujarati', lang: 'gu' });
  });
  it('uses Devanagari Noto for Hindi letters and Latin Noto for Latin', () => {
    expect(pdfWordFont('कखगघङ')).toEqual({ family: 'Noto Sans Devanagari', lang: 'hi' });
    expect(pdfWordFont('Placeholder')).toEqual({ family: 'Noto Sans', lang: 'en' });
  });
});
