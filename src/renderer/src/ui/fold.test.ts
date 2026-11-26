import { describe, expect, it } from 'vitest';
import { clipInside, foldMove, glides } from './fold';

/*
 * A section's fold (alpha.24, uimotion; the owner's QA24-UI-3 "more interactive and more animated, more transitions"):
 * when a section under LIVE folds or unfolds with motion, and how. As a live look's touch (shared/appearance/moving.ts)
 * it moves only once the window has opened, with a graphics chip, with interface motion not Off and the computer not
 * set to reduce motion; and, as Lively's glides, never while the show is changing (0.8 s after an engine change).
 */

const QUIET = { opened: true, off: false, chip: 'yes', sinceShow: 5000 } as const;

describe('how a section folds', () => {
  it('fades in Calm and unrolls in Lively', () => {
    expect(foldMove({ ...QUIET, motion: 'calm' })).toBe('calm');
    expect(foldMove({ ...QUIET, motion: undefined })).toBe('calm');
    expect(foldMove({ ...QUIET, motion: 'lively' })).toBe('lively');
  });

  it('moves not at all while the window opens, with Off or reduced motion, without a known graphics chip, or as the show changes', () => {
    for (const motion of ['calm', 'lively']) {
      expect(foldMove({ ...QUIET, motion, opened: false }), `${motion}, opening`).toBeNull();
      expect(foldMove({ ...QUIET, motion, off: true }), `${motion}, reduced`).toBeNull();
      expect(foldMove({ ...QUIET, motion, chip: 'no' }), `${motion}, no chip`).toBeNull();
      expect(foldMove({ ...QUIET, motion, chip: 'unknown' }), `${motion}, chip not said yet`).toBeNull();
      expect(foldMove({ ...QUIET, motion, chip: undefined }), `${motion}, no chip said`).toBeNull();
      expect(foldMove({ ...QUIET, motion, sinceShow: 800 }), `${motion}, the show just changed`).toBeNull();
      expect(foldMove({ ...QUIET, motion, sinceShow: 801 }), `${motion}, quiet again`).not.toBeNull();
    }
    expect(foldMove({ ...QUIET, motion: 'off' })).toBeNull();
  });
});

describe('what is under a section, gliding to its new place (Lively)', () => {
  it('glides each part from where it was by the difference, and leaves still what did not move', () => {
    expect(glides([100, 200, 300], [160, 260, 300])).toEqual([-60, -60, 0]);
    expect(glides([100, 200], [40.4, 199.5])).toEqual([59.6, 0]);
  });

  it('glides nothing it cannot pair', () => {
    expect(glides([100], [160, 260])).toEqual([0, 0]);
    expect(glides([], [])).toEqual([]);
  });
});

describe('the copy of what folds away, kept inside its column', () => {
  it('is clipped to the column’s scrolling part, in the window', () => {
    expect(clipInside({ top: 300, right: 1000, bottom: 600, left: 620 }, { width: 1024, height: 645 })).toBe(
      'inset(300px 24px 45px 620px)',
    );
  });

  it('never clips by less than nothing', () => {
    expect(clipInside({ top: -10, right: 1100, bottom: 700, left: -5 }, { width: 1024, height: 645 })).toBe(
      'inset(0px 0px 0px 0px)',
    );
  });
});
