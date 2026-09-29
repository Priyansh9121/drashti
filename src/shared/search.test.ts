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

  it('asks for every word, each as the start of a word', () => {
    expect(ftsQuery('  Namūnā  pan ')).toBe('"namuna"* "pan"*');
    expect(ftsQuery('— !')).toBeNull();
    expect(matchesAll(['nam', 'pa'], searchWords('Namūnā pankti'))).toBe(true);
    expect(matchesAll(['amu'], searchWords('Namūnā'))).toBe(false);
  });
});
