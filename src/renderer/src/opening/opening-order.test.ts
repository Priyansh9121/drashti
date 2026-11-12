import { describe, expect, it } from 'vitest';
import { openingHolds, photoWait, stillAfterHold, type StartFacts, windowMayStart } from './opening-order';

/*
 * The order of Drashti's start under the opening (Session 57, item 6). On CI's Mac the window starting underneath took
 * the operator window's main thread for 1 to 1.3 s at a time while the opening moved, and the opening ran 2,633 ms
 * (2,864 on two cores) for its 2,000. So the window starts under the opening's black as soon as that covers it, as
 * early as before, and the opening holds, black, until the window underneath has opened; then its two seconds run with
 * nothing starting under them.
 */

/** An opening that plays, its black drawn, the screens drawn, the window underneath not yet open. */
const covered: StartFacts = {
  plan: 'plays',
  covered: true,
  screensWarming: false,
  windowOpened: false,
  waitedOut: false,
  ended: false,
};

describe('the window underneath', () => {
  it('starts at once when no opening plays', () => {
    expect(windowMayStart({ ...covered, plan: 'none', covered: false })).toBe(true);
  });

  it('waits for the main process’s answer, so it never shows before the opening’s black', () => {
    expect(windowMayStart({ ...covered, plan: 'asking', covered: false })).toBe(false);
  });

  it('starts under the opening’s black once that has drawn, before anything moves', () => {
    expect(windowMayStart({ ...covered, covered: false })).toBe(false);
    expect(windowMayStart(covered)).toBe(true);
    // Under the screens' hold too, as before.
    expect(windowMayStart({ ...covered, screensWarming: true })).toBe(true);
  });

  it('starts at once when the opening ends, by a key or a click', () => {
    expect(windowMayStart({ ...covered, covered: false, ended: true })).toBe(true);
  });
});

describe('the opening holds, black', () => {
  it('until the window underneath has opened, so nothing starts under its two seconds', () => {
    expect(openingHolds(covered)).toBe(true);
    expect(openingHolds({ ...covered, windowOpened: true })).toBe(false);
  });

  it('and until the hall’s screens have drawn, as before', () => {
    expect(openingHolds({ ...covered, windowOpened: true, screensWarming: true })).toBe(true);
  });

  it('for OPENING_HOLD_MS at most: then it moves, still only when the screens were what it waited for', () => {
    const late = { ...covered, waitedOut: true };
    expect(openingHolds(late)).toBe(false);
    expect(stillAfterHold(late)).toBe(false);
    expect(openingHolds({ ...late, screensWarming: true })).toBe(false);
    expect(stillAfterHold({ ...late, screensWarming: true })).toBe(true);
  });

  it('never once it has ended, nor without an opening', () => {
    expect(openingHolds({ ...covered, ended: true })).toBe(false);
    expect(openingHolds({ ...covered, plan: 'none' })).toBe(false);
    expect(openingHolds({ ...covered, plan: 'asking' })).toBe(false);
  });
});

describe('its photo', () => {
  // CI's Mac (run 43171930738, opening.spec.ts:544 at :558): the window starting under the hold kept the page busy past
  // the photo's 600 ms, its decode lost to that timer, and the lamp lit in the photo's place.
  it('has no limit while the opening holds anyway: the photo holds nothing up then', () => {
    expect(photoWait(true, 600)).toBeNull();
  });

  it('holds it up for its limit at most once nothing else does (then the lamp lights in its place)', () => {
    expect(photoWait(false, 600)).toBe(600);
  });
});
