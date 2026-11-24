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

/**
 * A page's own work for a cue's Go moment (S5: the scene's swap, render/useCuedStart.ts; a cued slot's activation,
 * render/BackgroundMedia.tsx): on the first animation frame at or past `at` (`checkNow`: at once, too, if `at` has
 * passed already). Returns its cancel.
 */
export function atGoMoment(
  at: number,
  work: (now: number) => void,
  options: { checkNow: boolean },
  clock: GoMomentClock = PAGE,
): () => void {
  let frame = 0;
  const tick = () => {
    const now = clock.now();
    if (now >= at) work(now);
    else frame = clock.frame(tick);
  };
  if (options.checkNow) tick();
  else frame = clock.frame(tick);
  return () => clock.cancelFrame(frame);
}
