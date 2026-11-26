import { describe, expect, it } from 'vitest';
import { clipInside, foldCopy, foldMove, glides, glidesIn, scrollsBack } from './fold';
import { livelyWith } from './motion';

/*
 * A section's fold (alpha.24, uimotion; the owner's QA24-UI-3 "more interactive and more animated, more transitions"):
 * when a section under LIVE folds or unfolds with motion, and how. It moves only once the window has opened, with a
 * graphics chip known to be there (as a live look's touch needs one), with interface motion not Off and the computer not
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

/*
 * The release lead's review (27 Nov 2026). MUST-1: Lively, all of it, waits for a graphics chip (a new install's
 * default stays Lively; without a chip it looks as Calm does). MUST-2: no copy of what folds away is drawn where a show
 * control could end up under it.
 */
describe('Lively, held as every newer motion is', () => {
  const NOW = { motion: 'lively', off: false, chip: 'yes', sinceShow: 5000 } as const;

  it('moves with a graphics chip, the show quiet', () => {
    expect(livelyWith(NOW)).toBe(true);
  });

  it('is held without a known chip, with Off or reduced motion, in Calm, or as the show changes', () => {
    expect(livelyWith({ ...NOW, chip: 'no' })).toBe(false);
    expect(livelyWith({ ...NOW, chip: 'unknown' })).toBe(false);
    expect(livelyWith({ ...NOW, chip: undefined })).toBe(false);
    expect(livelyWith({ ...NOW, off: true })).toBe(false);
    expect(livelyWith({ ...NOW, motion: 'calm' })).toBe(false);
    expect(livelyWith({ ...NOW, sinceShow: 800 })).toBe(false);
  });
});

describe('the copy of what folds away', () => {
  it('is Calm’s or Lively’s when no show control is near', () => {
    expect(foldCopy('calm', false)).toBe('fold');
    expect(foldCopy('lively', false)).toBe('fold-lively');
  });

  it('is never drawn where a show control moves or sits in the same column', () => {
    expect(foldCopy('calm', true)).toBeNull();
    expect(foldCopy('lively', true)).toBeNull();
  });
});

/*
 * Lead 2's hands-on pass of 68394720e (N/reports/a24-uimotion-handson.md, problem 1): folding the last section with the
 * column scrolled to its end, the column scrolls back at once, and a glide measured in the window's coordinates read
 * that as the section moving (its heading slid over the one above for 187.5 ms). Measured inside the scrolling part,
 * a fold that only scrolls the column glides nothing; and no copy is drawn where the column will scroll back.
 */
describe('a fold at the column’s end', () => {
  it('glides only what moved inside the scrolling part, never the column scrolling back', () => {
    // OSC, the last section, folded at the end: the column scrolls back 80 px, OSC's heading stays where it is in it.
    expect(glidesIn({ tops: [900], scroll: 500 }, { tops: [980], scroll: 420 })).toEqual([0]);
    // A section in the middle folded at the end: the ones under it move up 80 px inside the column, the column 30.
    expect(glidesIn({ tops: [300, 700], scroll: 500 }, { tops: [330, 650], scroll: 470 })).toEqual([0, 80]);
    // Not scrolled: as before.
    expect(glidesIn({ tops: [100, 200], scroll: 0 }, { tops: [100, 280], scroll: 0 })).toEqual([0, -80]);
  });

  it('knows when folding will scroll the column back', () => {
    // 1965 tall, 504 in sight, at its end (1461): 80 px folding away scrolls it back.
    expect(scrollsBack({ scrollTop: 1461, clientHeight: 504, scrollHeight: 1965 }, 80)).toBe(true);
    // Room under what is in sight for what goes: no scrolling back.
    expect(scrollsBack({ scrollTop: 1000, clientHeight: 504, scrollHeight: 1965 }, 80)).toBe(false);
    expect(scrollsBack({ scrollTop: 0, clientHeight: 504, scrollHeight: 504 }, 80)).toBe(false);
  });
});
