import { describe, expect, it } from 'vitest';
import { htmlLang, textLang } from './lang';

/* The lang tags words get (Sessions 31–36, I18N-4). Placeholder words only. */

describe('lang tags', () => {
  it('say what a transliteration is of: gu-Latn, hi-Latn or sa-Latn; gu-Latn when nothing says', () => {
    expect(htmlLang('translit', 'gu')).toBe('gu-Latn');
    expect(htmlLang('translit', 'hi')).toBe('hi-Latn');
    expect(htmlLang('translit', 'sa')).toBe('sa-Latn');
    expect(htmlLang('translit')).toBe('gu-Latn');
    expect(['en', 'gu', 'hi', 'sa', 'sa-gu'].map((l) => htmlLang(l as 'en'))).toEqual([
      'en',
      'gu',
      'hi',
      'sa',
      'sa-Gujr',
    ]);
  });

  it('go by the letters of words no one marked, and are left out where there are none', () => {
    expect(textLang('નમૂના સંદેશ')).toBe('gu');
    expect(textLang('नमूना संदेश')).toBe('hi');
    expect(textLang('Placeholder message')).toBe('en');
    expect(textLang('Namūnā paṅkti', 'hi')).toBe('hi-Latn');
    expect(textLang('12:30 — 3')).toBeUndefined();
  });
});
