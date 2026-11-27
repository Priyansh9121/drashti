import { describe, expect, it } from 'vitest';
import { NO_STAGE_SCREEN } from './screen-switches';
import { saidShort } from './screens';

/*
 * The screens' one line in the status bar (alpha.24, lead 2's screensaid; the release lead's rules): its words in sight
 * are a few, whole (never "…"), so it and the access line ("No access list") both fit at CI's 1024 × 645; the whole
 * line (ScreensSaid's text) is its tooltip and what a screen reader reads.
 */

describe('the screens’ line in short words', () => {
  it('says each kind in a few words, whole', () => {
    expect(saidShort({ kind: 'no-stage', displayIds: [1, 2] })).toBe('No Stage screen');
    expect(saidShort({ kind: 'set', displayIds: [1] })).toBe('New screen set up');
    // The plural without "new" (saidwords, lead 2): the count says it, and Simple Mode's line fits at 1024 × 645.
    expect(saidShort({ kind: 'set', displayIds: [1, 2] })).toBe('2 screens set up');
    expect(saidShort({ kind: 'set', displayIds: [1, 2, 3] })).toBe('3 screens set up');
    expect(saidShort({ kind: 'mirroring', displayIds: [] })).toBe('Screen mirrored');
    for (const kind of ['no-stage', 'set', 'mirroring'] as const)
      for (const displayIds of [[], [1], [1, 2, 3]]) {
        const words = saidShort({ kind, displayIds });
        expect(words.length, words).toBeLessThanOrEqual(21);
        expect(words, words).not.toContain('…');
      }
  });

  it('is about what the whole line says', () => {
    expect(NO_STAGE_SCREEN).toContain('Stage');
    expect(saidShort({ kind: 'no-stage', displayIds: [] })).toContain('Stage');
  });
});
