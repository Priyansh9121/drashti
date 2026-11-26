import { describe, expect, it } from 'vitest';
import {
  CAPTION_PAGE_MIN_MS,
  CAPTION_PAGE_MS_PER_WORD,
  CAPTION_TARGET_NAMES,
  CAPTION_TARGETS,
  DEFAULT_CAPTION_TARGET,
  NO_CAPTION_TRANSLATION,
  TRANSLATED_LONGEST_MS,
  TRANSLATION_STOP_AFTER_LATE,
  isCaptionTarget,
  translationTarget,
} from './caption-translation';
import { CAPTION_LONGEST_MS } from './captions';
import { SPEECH_LANGUAGES } from './speech';

describe('"Captions in" (alpha.24, QA24-CAPLANG-2)', () => {
  it('offers the speaker’s own words first (the default), then Gujarati, Hindi and English, each named', () => {
    expect(CAPTION_TARGETS).toEqual(['same', 'gu', 'hi', 'en']);
    expect(DEFAULT_CAPTION_TARGET).toBe('same');
    expect(Object.keys(CAPTION_TARGET_NAMES)).toEqual([...CAPTION_TARGETS]);
    expect(CAPTION_TARGET_NAMES.same).toBe('Same as the speaker');
    // Every translation is a trial (2d, 2e).
    for (const t of ['gu', 'hi', 'en'] as const) expect(CAPTION_TARGET_NAMES[t]).toMatch(/\(trial\)$/u);
    expect(isCaptionTarget('hi')).toBe(true);
    expect(isCaptionTarget('sa')).toBe(false);
    expect(isCaptionTarget('auto')).toBe(false);
    expect(isCaptionTarget(undefined)).toBe(false);
  });

  it('translates only between Gujarati, Hindi and English, from one chosen speaker’s language into another', () => {
    const pairs: string[] = [];
    for (const speaker of ['auto', ...SPEECH_LANGUAGES] as const)
      for (const target of CAPTION_TARGETS) {
        const to = translationTarget(speaker, target);
        if (to !== null) pairs.push(`${speaker}->${to}`);
      }
    // 2d: all six pairs, nothing else.
    expect(pairs.sort()).toEqual(['en->gu', 'en->hi', 'gu->en', 'gu->hi', 'hi->en', 'hi->gu']);
    // The speaker's own language, "as heard", Sanskrit, "same" or a value from before alpha.24: the speaker's words.
    expect(translationTarget('gu', 'gu')).toBeNull();
    expect(translationTarget('auto', 'hi')).toBeNull();
    expect(translationTarget('sa', 'gu')).toBeNull();
    expect(translationTarget('hi', 'same')).toBeNull();
    expect(translationTarget('hi', undefined)).toBeNull();
  });

  it('cuts translated phrases shorter than the default, stops after late ones in a row, and pages by reading time', () => {
    expect(TRANSLATED_LONGEST_MS).toBe(8_000);
    expect((CAPTION_LONGEST_MS as readonly number[]).includes(TRANSLATED_LONGEST_MS)).toBe(true);
    expect(TRANSLATED_LONGEST_MS).toBeLessThan(CAPTION_LONGEST_MS[0]);
    expect(TRANSLATION_STOP_AFTER_LATE).toBe(3);
    expect(CAPTION_PAGE_MS_PER_WORD).toBeGreaterThan(0);
    expect(CAPTION_PAGE_MIN_MS).toBeGreaterThanOrEqual(1_000);
  });

  it('starts with nothing translated, nothing skipped and no fault', () => {
    expect(NO_CAPTION_TRANSLATION).toEqual({
      target: null,
      offered: false,
      unavailable: null,
      skipped: 0,
      fault: null,
    });
    expect(Object.isFrozen(NO_CAPTION_TRANSLATION)).toBe(true);
  });
});
