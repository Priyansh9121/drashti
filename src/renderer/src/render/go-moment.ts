import { engineNow } from './clock';

/** What a page's work for a cue's Go moment runs on: the engine's time, its animation frames and its timers. */
export interface GoMomentClock {
  now(): number;
  frame(run: () => void): number;
  cancelFrame(id: number): void;
  later(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancelLater(id: ReturnType<typeof setTimeout>): void;
}

const PAGE: GoMomentClock = {
  now: engineNow,
  frame: (run) => requestAnimationFrame(run),
  cancelFrame: (id) => cancelAnimationFrame(id),
  // eslint-disable-next-line no-restricted-syntax -- never decides a frame: the operator preview's own React work waits behind its picture's start, a check of the moment at most
  later: (run, ms) => setTimeout(run, ms),
  cancelLater: (id) => clearTimeout(id),
};

/** The operator preview's wait for its cued picture's start at Go (QA23-CUELIVE-1). */
export interface AfterStart {
  /** Runs `run` once this page's cued picture has set its rate at Go (at once if it has); returns its cancel. */
  whenStarted(run: () => void): () => void;
  /** Where it never starts (it failed, say): the work runs this long after Go at the latest. */
  fallbackMs: number;
  /** Told when that wait ends without the start, before the work runs (cue-started.ts: decided, whatever the clock). */
  gaveUp?: () => void;
}

/**
 * A page's own work for a cue's Go moment (S5: the scene's swap, render/useCuedStart.ts; a cued slot's activation,
 * render/BackgroundMedia.tsx): on the first animation frame at or past `at` (`checkNow`: at once, too, if `at` has
 * passed already). With `afterStart` (the operator's LIVE preview, QA23-CUELIVE-1) it waits from then for its cued
 * picture's start, so that picture's own check for Go never waits behind this React work: on alpha.22's gate 3 (CI's
 * Mac) LIVE's picture set its rate 23-27 ms after Go, behind the operator window's work, and started 37-40 ms late.
 * Every other page as before. Returns its cancel.
 */
export function atGoMoment(
  at: number,
  work: (now: number) => void,
  options: { checkNow: boolean; afterStart?: AfterStart },
  clock: GoMomentClock = PAGE,
): () => void {
  let frame = 0;
  let waiting: (() => void) | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    waiting?.();
    if (fallback !== null) clock.cancelLater(fallback);
    work(clock.now());
  };
  const tick = () => {
    const now = clock.now();
    if (now < at) {
      frame = clock.frame(tick);
      return;
    }
    const after = options.afterStart;
    if (!after) {
      work(now);
      return;
    }
    // Counted from Go, so a wait begun later (the slot's activation, after the swap's render) is not that much more.
    const giveUp = () => {
      if (done) return;
      after.gaveUp?.();
      run();
    };
    fallback = clock.later(giveUp, Math.max(0, at + after.fallbackMs - now));
    waiting = after.whenStarted(run);
  };
  if (options.checkNow) tick();
  else frame = clock.frame(tick);
  return () => {
    done = true;
    clock.cancelFrame(frame);
    waiting?.();
    if (fallback !== null) clock.cancelLater(fallback);
  };
}
