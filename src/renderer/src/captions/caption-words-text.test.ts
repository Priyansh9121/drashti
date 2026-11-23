import { describe, expect, it } from 'vitest';
import { captionWordsHintText } from './caption-words-text';

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

  it('says when they are not used now: another language chosen, or the language left as heard', () => {
    expect(captionWordsHintText('Hindi', 2, 2, 'gu', 'hi')).toBe(
      '2 Hindi words, used when captions listen for Hindi.',
    );
    expect(captionWordsHintText('Hindi', 2, 2, 'auto', 'hi')).toBe(
      '2 Hindi words. With the language left as heard, spellings are fixed but the engine is given no hints.',
    );
  });
});
