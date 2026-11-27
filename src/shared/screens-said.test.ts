import { describe, expect, it } from 'vitest';
import { NO_STAGE_SCREEN, SET_UP_STAGE } from './screen-switches';
import { saidShort } from './screens';
import { saidTips } from './screens-said';

/*
 * The screens' one line in the status bar (alpha.24, lead 2's screensaid; the release lead's rules): its words in sight
 * are a few, whole (never "…"), so it and the access line ("No access list") both fit at CI's 1024 × 645; the whole
 * line (ScreensSaid's text) is its tooltip and what a screen reader reads.
 */

describe('the screens’ line in short words', () => {
  it('says each kind in a few words, whole', () => {
    expect(saidShort({ kind: 'no-stage', displayIds: [1, 2] })).toBe('No Stage screen');
    expect(saidShort({ kind: 'set', displayIds: [1] })).toBe('New screen set up');
    expect(saidShort({ kind: 'set', displayIds: [1, 2] })).toBe('2 new screens set up');
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

/*
 * Each part's own tooltip (the release lead's alpha.25 item 40, new in alpha.24, done in saidwords): on keyboard focus
 * both buttons had shown the line's sentence. The words (and the icon) show the whole line; the action button says
 * what it does; the X says Dismiss, with the line.
 */
describe('the screens’ line: each part’s own tooltip', () => {
  it('the words the whole line, each button what it does, the X Dismiss with the line', () => {
    expect(saidTips({ kind: 'no-stage', text: NO_STAGE_SCREEN })).toEqual({
      words: 'No screen is set to Stage.',
      action: `${SET_UP_STAGE}: opens Screens, to give a display the Stage job`,
      dismiss: 'Dismiss: No screen is set to Stage.',
    });
    const set = { kind: 'set', text: '“Placeholder projector” shows the audience picture.' } as const;
    expect(saidTips(set)).toEqual({
      words: '“Placeholder projector” shows the audience picture.',
      action: 'Change…: opens Screens at this display, to give it another job',
      dismiss: 'Dismiss: “Placeholder projector” shows the audience picture.',
    });
    // Mirroring has no action button.
    expect(saidTips({ kind: 'mirroring', text: 'Placeholder words.' }).action).toBeNull();
    for (const kind of ['no-stage', 'set', 'mirroring'] as const) {
      const tips = saidTips({ kind, text: 'Placeholder words.' });
      expect(tips.dismiss).toMatch(/^Dismiss: /u);
      if (tips.action !== null) expect(tips.action).not.toBe(tips.words);
    }
  });
});
