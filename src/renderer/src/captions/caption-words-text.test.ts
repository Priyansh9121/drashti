import { describe, expect, it } from 'vitest';
import type { CaptionWord } from '../../../shared/caption-words';
import type { SpeechLanguage } from '../../../shared/speech';
import { captionWordsHintText, captionWordsLine } from './caption-words-text';

/* The Caption Words dialog's line under the list (alpha.22): how many words, and which go to the engine as hints. */

describe('the Caption Words dialog’s line about hints', () => {
  it('says how many words there are and how many the captions engine is given as hints', () => {
    expect(captionWordsHintText('Gujarati', 0, 0, 'gu', 'gu')).toBe('No Gujarati caption words yet.');
    expect(captionWordsHintText('Gujarati', 1, 1, 'gu', 'gu')).toBe(
      '1 Gujarati word, given to the captions engine as a hint.',
    );
    expect(captionWordsHintText('Gujarati', 3, 3, 'gu', 'gu')).toBe(
      '3 Gujarati words, all given to the captions engine as hints.',
    );
    expect(captionWordsHintText('Gujarati', 12, 6, 'gu', 'gu')).toBe(
      '12 Gujarati words. The first 6 fit in the captions engine’s hints, so put the most important first; all of them fix spellings.',
    );
  });

  it('says when the hints are switched off for the language (Gujarati at first), spellings still fixed', () => {
    expect(captionWordsHintText('Gujarati', 3, 0, 'gu', 'gu', false)).toBe(
      '3 Gujarati words. Hints for the captions engine are off for Gujarati; spellings are still fixed.',
    );
  });

  it('says when they are not used now: another language chosen, or the language left as heard', () => {
    expect(captionWordsHintText('Hindi', 2, 2, 'gu', 'hi')).toBe(
      '2 Hindi words, used when captions listen for Hindi.',
    );
    expect(captionWordsHintText('Hindi', 2, 2, 'auto', 'hi')).toBe(
      '2 Hindi words. With the language left as heard, spellings are fixed but the engine is given no hints.',
    );
  });

  it('counts only the entries in the language’s letters (review R2-1: one in other letters never shows and is no hint)', () => {
    const GU = 'ઝેન્ટ્રોવા';
    const HI = 'वेल्मोरिन';
    const of = (language: SpeechLanguage, ...words: string[]): CaptionWord[] =>
      words.map((word) => ({ language, word }));
    expect(captionWordsLine(of('gu', 'Zentrova'), 0, 'gu', 'gu')).toBe(
      'No Gujarati caption words in Gujarati letters yet.',
    );
    expect(captionWordsLine(of('gu', 'Zentrova', GU), 1, 'gu', 'gu')).toBe(
      '1 Gujarati word, given to the captions engine as a hint.',
    );
    expect(captionWordsLine(of('gu', 'Zentrova', GU, HI), 1, 'gu', 'gu')).toBe(
      '1 Gujarati word, given to the captions engine as a hint.',
    );
    expect(captionWordsLine(of('hi', GU, HI, 'Person Q7'), 1, 'hi', 'hi')).toBe(
      '1 Hindi word, given to the captions engine as a hint.',
    );
    // Sanskrit in either Indian script; an English entry in Indian letters is counted the same way.
    expect(captionWordsLine(of('sa', GU, HI, 'Zentrova'), 2, 'sa', 'sa')).toBe(
      '2 Sanskrit words, all given to the captions engine as hints.',
    );
    expect(captionWordsLine(of('en', GU), 0, 'en', 'en')).toBe(
      'No English caption words in English letters yet.',
    );
    expect(captionWordsLine(of('en', GU, 'Zentrova'), 1, 'gu', 'en')).toBe(
      '1 English word, used when captions listen for English.',
    );
    // With none at all, and with every entry in its letters, the line is as it was.
    expect(captionWordsLine([], 0, 'gu', 'gu')).toBe('No Gujarati caption words yet.');
    expect(captionWordsLine(of('gu', GU, `${GU}2`, `${GU}3`), 2, 'gu', 'gu', false)).toBe(
      captionWordsHintText('Gujarati', 3, 2, 'gu', 'gu', false),
    );
  });
});
