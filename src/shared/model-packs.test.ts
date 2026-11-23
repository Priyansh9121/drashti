import { describe, expect, it } from 'vitest';
import { isModelPurpose, MODEL_PURPOSES, purposeWords } from './model-packs';

/* What a pack's models may be for (alpha.22, cap-pack): captions in Gujarati, Hindi or English, or translation
 * between two of them; in words for the dialog. */

describe('a model’s purposes (alpha.22, cap-pack)', () => {
  it('are captions in each language and translation between any two', () => {
    expect(MODEL_PURPOSES).toEqual([
      'captions-gu',
      'captions-hi',
      'captions-en',
      'translation-gu-hi',
      'translation-gu-en',
      'translation-hi-gu',
      'translation-hi-en',
      'translation-en-gu',
      'translation-en-hi',
    ]);
    expect(isModelPurpose('captions-gu')).toBe(true);
    expect(isModelPurpose('captions-sa')).toBe(false);
    expect(isModelPurpose('translation-gu-gu')).toBe(false);
    expect(isModelPurpose('licence')).toBe(false);
  });

  it('read as words', () => {
    expect(purposeWords('captions-gu')).toBe('Captions in Gujarati');
    expect(purposeWords('translation-en-hi')).toBe('Translation from English into Hindi');
    expect(purposeWords('translation-hi-gu')).toBe('Translation from Hindi into Gujarati');
  });
});
