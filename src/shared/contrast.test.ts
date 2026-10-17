import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  darkened,
  luminance,
  WORDS_CONTRAST_AIM,
  WORDS_CONTRAST_MIN,
  wordsContrast,
} from './contrast';

describe('contrast (WCAG 2)', () => {
  it('measures black and white, a colour against itself, and either way round', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#3366cc', '#3366cc')).toBe(1);
    expect(contrastRatio('#ffffff', '#767676')).toBe(contrastRatio('#767676', '#ffffff'));
  });

  it('gives the ratios WCAG names: #767676 on white just passes 4.5:1, #777777 just fails', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(luminance('#ffffff')).toBe(1);
    expect(luminance('#000000')).toBe(0);
  });
});

describe('darkening behind the words (Sessions 31–36, SLD-3)', () => {
  it('white words over white warn; a 70% band clears them, a 40% one does not', () => {
    expect(wordsContrast('#ffffff', '#ffffff')).toBeLessThan(WORDS_CONTRAST_MIN);
    expect(wordsContrast('#ffffff', '#ffffff', { strength: 0.7 })).toBeGreaterThanOrEqual(WORDS_CONTRAST_MIN);
    expect(wordsContrast('#ffffff', '#ffffff', { strength: 0.4 })).toBeLessThan(WORDS_CONTRAST_MIN);
    // 80% reaches Drashti's own aim.
    expect(wordsContrast('#ffffff', '#ffffff', { strength: 0.8 })).toBeGreaterThanOrEqual(WORDS_CONTRAST_AIM);
    expect(darkened('#ffffff', 0.7)).toBe('#4d4d4d');
  });
});
