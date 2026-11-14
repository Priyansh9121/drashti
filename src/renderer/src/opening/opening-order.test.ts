import { describe, expect, it, vi } from 'vitest';
import {
  afterCoverFrame,
  openingHolds,
  photoWait,
  releasedBy,
  stillAfterHold,
  type FrameWatch,
  type StartFacts,
  watchFrame,
  windowMayStart,
} from './opening-order';

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
  windowFrameReady: false,
  windowWarming: false,
  waitedOut: false,
  startWaitedOut: false,
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

  it('starts within 100 ms even if a hidden window gets no animation frame', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const covered = vi.fn();
    const dispose = afterCoverFrame(covered);
    try {
      vi.advanceTimersByTime(99);
      expect(covered).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(covered).toHaveBeenCalledOnce();
    } finally {
      dispose();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('starts at once when the opening ends, by a key or a click', () => {
    expect(windowMayStart({ ...covered, covered: false, ended: true })).toBe(true);
  });
});

describe('the opening holds, black', () => {
  it('until the window underneath has opened, so nothing starts under its two seconds', () => {
    expect(openingHolds(covered)).toBe(true);
    expect(openingHolds({ ...covered, windowOpened: true, windowFrameReady: true })).toBe(false);
  });

  it('does not start its timeline while the window is still missing frames after it opens', () => {
    const busy = { ...covered, windowOpened: true, windowFrameReady: false };
    expect(openingHolds(busy)).toBe(true);
    expect(openingHolds({ ...busy, windowFrameReady: true })).toBe(false);
    // The screens' limit is not the window's (Session 58).
    expect(openingHolds({ ...busy, waitedOut: true })).toBe(true);
    expect(openingHolds({ ...busy, startWaitedOut: true })).toBe(false);
  });

  // Session 58 (C4, Q57-32): on CI's Mac the window's own GPU warm-up was still making pipelines (100-600 ms each, every
  // window waiting) after the window had opened, and the opening's first move came 0.3-3 s late.
  it('and until the window’s own GPU warm-up is over, so its two seconds never share the GPU with it', () => {
    const warming = { ...covered, windowOpened: true, windowFrameReady: true, windowWarming: true };
    expect(openingHolds(warming)).toBe(true);
    expect(openingHolds({ ...warming, windowWarming: false })).toBe(false);
    // Past the screens' limit too: that one is theirs.
    expect(openingHolds({ ...warming, waitedOut: true })).toBe(true);
  });

  it('for OPENING_START_HOLD_MS at most for the window: then it moves, as it would', () => {
    const late = { ...covered, windowWarming: true, waitedOut: true, startWaitedOut: true };
    expect(openingHolds(late)).toBe(false);
    expect(stillAfterHold(late)).toBe(false);
  });

  it('and until the hall’s screens have drawn, as before', () => {
    expect(
      openingHolds({ ...covered, windowOpened: true, windowFrameReady: true, screensWarming: true }),
    ).toBe(true);
  });

  it('for OPENING_HOLD_MS at most for the screens: then it moves, still only when the screens were what it waited for', () => {
    const late = { ...covered, windowOpened: true, windowFrameReady: true, waitedOut: true };
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

describe('what let it go, for its figures', () => {
  const ready = { ...covered, windowOpened: true, windowFrameReady: true };
  it('everything it waits for ready', () => {
    expect(releasedBy(ready)).toBe('ready');
  });

  it('a limit, with something still not ready: the screens, the window or its warm-up', () => {
    expect(releasedBy({ ...ready, screensWarming: true, waitedOut: true })).toBe('limit');
    expect(releasedBy({ ...ready, windowWarming: true, startWaitedOut: true })).toBe('limit');
    expect(releasedBy({ ...ready, windowFrameReady: false, startWaitedOut: true })).toBe('limit');
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

describe('the window’s frames before it moves (Session 58)', () => {
  /**
   * Frames every 17 ms (or as given), each read `late` ms after it began, its own warm-up drawing (`warming`) or fonts
   * loading as given; the index of the frame it may move at, or null.
   */
  function readyAt(
    frames: { at: number; late?: number; warming?: boolean; fonts?: boolean }[],
  ): number | null {
    let w: FrameWatch = { previous: null, steady: 0, warmedUp: false };
    for (const [i, f] of frames.entries()) {
      const next = watchFrame(
        w,
        { at: f.at, now: f.at + (f.late ?? 2), warming: f.warming ?? false, fontsLoading: f.fonts ?? false },
        50,
        4,
      );
      if (next.ready) return i;
      w = next;
    }
    return null;
  }
  const even = (n: number, from = 0, step = 17) =>
    Array.from({ length: n }, (_, i) => ({ at: from + i * step }));

  it('with no warm-up of its own (a computer drawing without a graphics chip skips it): at the first frame on time', () => {
    // As before Session 58: the plain Windows pair moved four frames later with four for everyone (c4winb).
    expect(readyAt(even(10))).toBe(1);
  });

  it('after its own warm-up: four frames in a row on time, for what comes just after it (its fonts, two frames on)', () => {
    const frames = even(14).map((f, i) => ({ ...f, warming: i < 5 }));
    expect(readyAt(frames)).toBe(9);
  });

  it('never while its fonts load, and after them at the first frame on time when it had no warm-up', () => {
    const frames = even(10).map((f, i) => ({ ...f, fonts: i < 4 }));
    expect(readyAt(frames)).toBe(5);
  });

  it('after its warm-up, its fonts loading start the count again', () => {
    const frames = even(16).map((f, i) => ({ ...f, warming: i < 3, fonts: i >= 5 && i < 7 }));
    expect(readyAt(frames)).toBe(11);
  });

  it('a long frame (the fonts laid out, 115-560 ms on CI’s Mac) starts the count again', () => {
    const frames = [...even(3).map((f) => ({ ...f, warming: true })), ...even(3, 51), ...even(8, 85 + 300)];
    expect(readyAt(frames)).toBe(6 + 4);
  });

  it('a frame read long after it began does not count', () => {
    const frames = even(10).map((f, i) => ({ ...f, late: i === 1 ? 80 : 2 }));
    expect(readyAt(frames)).toBe(2);
  });
});
