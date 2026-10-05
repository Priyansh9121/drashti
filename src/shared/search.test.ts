import { describe, expect, it } from 'vitest';
import { foldText, ftsQuery, matchesAll, searchWords } from './search';

describe('search folding', () => {
  it('drops Latin accents and case, so plain typing finds transliteration', () => {
    expect(foldText('Namūnānī ṭek')).toBe('namunani tek');
    expect(searchWords('Śrī Ṛṣi, Ēk!')).toEqual(['sri', 'rsi', 'ek']);
  });

  it('keeps Gujarati and Devanagari vowel signs and viramas inside their words', () => {
    // Placeholder words: "sample" and "line" in Gujarati and Hindi.
    expect(searchWords('નમૂના પંક્તિ')).toEqual(['નમૂના', 'પંક્તિ']);
    expect(searchWords('नमूना पंक्ति।')).toEqual(['नमूना', 'पंक्ति']);
  });

  it('ignores zero-width joiners and punctuation', () => {
    expect(searchWords('क्‍ष — “quoted” (x)')).toEqual(['क्ष', 'quoted', 'x']);
  });

  it('folds v and w, and doubled vowels, so one spelling finds another (Session 13)', () => {
    expect(foldText('Dwitiyah')).toBe(foldText('dvitiyah'));
    expect(searchWords('Shree')).toEqual(searchWords('Shri'));
    expect(searchWords('Shreeji Swaami Bhagwaan')).toEqual(['shriji', 'svami', 'bhagvan']);
    expect(searchWords('Poojaa')).toEqual(searchWords('Puja'));
    expect(searchWords('Aaa ee')).toEqual(['a', 'i']);
    // Prefixes still work after folding: typing "dwit" finds "dvitiyah".
    expect(matchesAll(searchWords('dwit'), searchWords('Dvitiyah adhyay'))).toBe(true);
    // English finds itself (both sides fold alike), and Gujarati and Devanagari are untouched.
    expect(matchesAll(searchWords('week'), searchWords('This week'))).toBe(true);
    expect(searchWords('નમૂના नमूना')).toEqual(['નમૂના', 'नमूना']);
  });

  it('asks for every word, each as the start of a word', () => {
    expect(ftsQuery('  Namūnā  pan ')).toBe('"namuna"* "pan"*');
    expect(ftsQuery('— !')).toBeNull();
    expect(matchesAll(['nam', 'pa'], searchWords('Namūnā pankti'))).toBe(true);
    expect(matchesAll(['amu'], searchWords('Namūnā'))).toBe(false);
  });
});
