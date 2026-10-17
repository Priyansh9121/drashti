import { describe, expect, it } from 'vitest';
import { cutByMarks, cutText } from './text';

/*
 * Cutting words to a limit (Sessions 31–36, I18N-5): never inside a letter. A Gujarati or Hindi conjunct
 * (ક્ષ, क्ष), a vowel sign, an accent or an emoji is kept whole or left out whole; the limit counts what a
 * string's length counts (UTF-16 units), as every limit in Drashti does. Placeholder words only.
 */

describe('cutText', () => {
  it('keeps ક્ષ and क्ष whole: a conjunct never loses its second letter', () => {
    // ક + ્ + ષ: three units, one letter.
    expect(cutText('અક્ષર', 2)).toBe('અ');
    expect(cutText('અક્ષર', 3)).toBe('અ');
    expect(cutText('અક્ષર', 4)).toBe('અક્ષ');
    expect(cutText('अक्षर', 3)).toBe('अ');
    expect(cutText('अक्षर', 4)).toBe('अक्ष');
    // A vowel sign stays with its letter.
    expect(cutText('नमूना', 2)).toBe('न');
    expect(cutText('નમૂના', 3)).toBe('નમૂ');
  });

  it('keeps an accent and an emoji whole, and counts what a limit counts', () => {
    expect(cutText('Namāste', 4)).toBe('Nam');
    expect(cutText('ok 👍🏽', 4)).toBe('ok ');
    expect(cutText('ok 👍🏽', 7)).toBe('ok 👍🏽');
    for (const max of [0, 1, 2, 3, 5, 8]) expect(cutText('અક્ષર नमूना', max).length).toBeLessThanOrEqual(max);
  });

  it('leaves words that fit as they are, and adds an ending only when it cut, inside the limit', () => {
    expect(cutText('Placeholder', 11)).toBe('Placeholder');
    expect(cutText('Placeholder', 11, '…')).toBe('Placeholder');
    expect(cutText('Placeholder words', 12, '…')).toBe('Placeholder…');
    expect(cutText('અક્ષર અક્ષર', 6, '…')).toBe('અક્ષર…');
    expect(cutText('અક્ષર અક્ષર', 5, '…')).toBe('અક્ષ…');
  });

  it('cuts alike without Intl.Segmenter (an older phone’s browser)', () => {
    expect(cutByMarks('અક્ષર', 3)).toBe('અ');
    expect(cutByMarks('અક્ષર', 4)).toBe('અક્ષ');
    expect(cutByMarks('अक्षर', 3)).toBe('अ');
    expect(cutByMarks('नमूना', 2)).toBe('न');
    expect(cutByMarks('Nama\u0304ste', 4)).toBe('Nam');
    expect(cutByMarks('ok 👍', 4)).toBe('ok ');
  });
});
