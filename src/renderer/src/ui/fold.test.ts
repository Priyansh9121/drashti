import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipInside, copyHeld, foldCopy, foldMove, glides, glidesIn, scrollsBack, whenArrived } from './fold';
import { hostless, livelyWith } from './motion';

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

/*
 * Lead 2's hands-on pass of uilook (N/reports/a24-uilook-handson.md, problem 1, uimotion's): in a light look a fold's
 * copy drew Black's dark controls, because the page's styles copied into its shadow root set Tailwind's theme on its
 * host (`:root, :host { --color-* }`) over the appearance <html> carries. The copy's styles keep no :host part, so the
 * host inherits the window's own appearance, as everything in the page does.
 */
describe('the copy draws in the window’s appearance', () => {
  it('keeps no :host part of a selector', () => {
    expect(hostless(':root, :host')).toBe(':root');
    expect(hostless('html, :host')).toBe('html');
    expect(hostless(':host')).toBe(':not(*)');
    expect(hostless(':host(.x) .y, .z')).toBe('.z');
  });

  it('leaves every other selector as it is, commas inside brackets too', () => {
    expect(hostless('.a, .b')).toBe('.a, .b');
    expect(hostless(':is(.a, .b) > .c')).toBe(':is(.a, .b) > .c');
    expect(hostless(':where(.hostile), .host')).toBe(':where(.hostile), .host');
  });
});

/*
 * Lead 2's item 8 for alpha.24 (the release lead's review of uimotion, NOTE-4 and NOTE-5). First: a change of motion
 * within 0.45 s of a heading's press played the insides' arrival again (Off, then Calm; Calm, then Lively), because the
 * section forgot how its insides arrived only on a timer. It now forgets as soon as their own arrival ends or is stopped,
 * the timer kept as the latest.
 */
describe('a section forgets how its insides arrived as soon as they have', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The insides as the browser has them: their own animations (a CSS animation has a name; a transition has none). */
  const body = (animations: { finished: Promise<unknown>; animationName?: string }[]) => ({
    getAnimations: () => animations,
  });
  const arrival = () => {
    let finish = () => {};
    let cancel = () => {};
    const finished = new Promise<void>((resolve, reject) => {
      finish = resolve;
      cancel = () => {
        reject(new DOMException('cancelled', 'AbortError'));
      };
    });
    return { animation: { finished, animationName: 'fade-in' }, finish, cancel };
  };
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('when their arrival ends', async () => {
    const a = arrival();
    const done = vi.fn();
    whenArrived(body([a.animation]), done, 60_000);
    await flush();
    expect(done).not.toHaveBeenCalled();
    a.finish();
    await flush();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('when their arrival is stopped (a change of motion: Off, reduced motion, Calm from Lively), so it never plays again', async () => {
    const a = arrival();
    const done = vi.fn();
    whenArrived(body([a.animation]), done, 60_000);
    a.cancel();
    await flush();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('at once when nothing arrives (a show control in them, Off): transitions are not their arrival', () => {
    const done = vi.fn();
    whenArrived(body([]), done, 60_000);
    expect(done).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    whenArrived(body([{ finished: new Promise(() => {}) }]), other, 60_000);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('at the latest after the time given (a hidden window), and never once stopped', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    whenArrived(body([arrival().animation]), done, 450);
    vi.advanceTimersByTime(449);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    const stopped = vi.fn();
    const stop = whenArrived(body([arrival().animation]), stopped, 450);
    stop();
    vi.advanceTimersByTime(1000);
    expect(stopped).not.toHaveBeenCalled();
  });
});

/*
 * Second: the copy of what folds away was held by a show control anywhere in the column, the glides only by one among
 * what moves. A show control higher in the column never moves as a section under it folds (the column scrolling back
 * aside), so the copy is held as the glides are: by a show control among what moves, by the LIVE block sharing the
 * column's scrolling part (a short window), or by the column scrolling back.
 */
describe('what holds the copy of what folds away', () => {
  const NONE = { movingShowControl: false, showControlAbove: false, liveBlockInScroller: false, scrollsBack: false };

  it('a show control among what moves, the LIVE block in the same scrolling part, or the column scrolling back', () => {
    expect(copyHeld(NONE)).toBe(false);
    expect(copyHeld({ ...NONE, movingShowControl: true })).toBe(true);
    expect(copyHeld({ ...NONE, liveBlockInScroller: true })).toBe(true);
    expect(copyHeld({ ...NONE, scrollsBack: true })).toBe(true);
  });

  it('never a show control higher in the column alone, which stays where it is', () => {
    expect(copyHeld({ ...NONE, showControlAbove: true })).toBe(false);
    expect(copyHeld({ ...NONE, showControlAbove: true, movingShowControl: true })).toBe(true);
  });
});
