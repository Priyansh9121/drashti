import { describe, expect, it } from 'vitest';
import { LANG_FONT_STACK } from './fonts';

/* The font stacks (Sessions 31–36, I18N-7). */

describe('font stacks', () => {
  it('have both Indian scripts wherever words in them can be, after Latin so Latin letters stay as they were', () => {
    const fonts = (stack: string) => stack.split(', ').map((f) => f.replace(/'/gu, ''));
    for (const lang of ['en', 'default', 'gu', 'sa-gu', 'hi', 'sa'] as const) {
      const list = fonts(LANG_FONT_STACK[lang]);
      expect(list, lang).toContain('Noto Sans Gujarati');
      expect(list, lang).toContain('Noto Sans Devanagari');
    }
    expect(fonts(LANG_FONT_STACK.gu)).toEqual([
      'Noto Sans Gujarati',
      'Noto Sans',
      'Noto Sans Devanagari',
      'sans-serif',
    ]);
    expect(fonts(LANG_FONT_STACK.hi)).toEqual([
      'Noto Sans Devanagari',
      'Noto Sans',
      'Noto Sans Gujarati',
      'sans-serif',
    ]);
    expect(fonts(LANG_FONT_STACK.translit)).toEqual(['Noto Sans', 'sans-serif']);
  });
});
