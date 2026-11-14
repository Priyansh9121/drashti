import { describe, expect, it, vi } from 'vitest';
import {
  afterCoverFrame,
  openingHolds,
  photoWait,
  releasedBy,
  stillAfterHold,
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
  /** Frames every `step` ms from `from`, each read `late` ms after it began, `busy` as given; ready at which one. */
  function readyAt(frames: { at: number; late?: number; busy?: boolean }[]): number | null {
    let w = { previous: null as number | null, steady: 0 };
    for (const [i, f] of frames.entries()) {
      const next = watchFrame(w, { at: f.at, now: f.at + (f.late ?? 2), busy: f.busy ?? false }, 50, 4);
      if (next.ready) return i;
      w = next;
    }
    return null;
  }
  const even = (n: number, from = 0, step = 17) =>
    Array.from({ length: n }, (_, i) => ({ at: from + i * step }));

  it('moves after four frames in a row on time', () => {
    expect(readyAt(even(10))).toBe(4);
  });

  it('never while its own GPU warm-up draws or its fonts load: the count starts again after', () => {
    const frames = even(12).map((f, i) => ({ ...f, busy: i < 5 }));
    expect(readyAt(frames)).toBe(9);
  });

  it('a long frame (the fonts laid out, 115-560 ms on CI’s Mac) starts the count again', () => {
    const frames = [...even(3), ...even(8, 34 + 300)];
    expect(readyAt(frames)).toBe(3 + 4);
  });

  it('a frame read long after it began does not count', () => {
    const frames = even(10).map((f, i) => ({ ...f, late: i === 3 ? 80 : 2 }));
    expect(readyAt(frames)).toBe(7);
  });
});
