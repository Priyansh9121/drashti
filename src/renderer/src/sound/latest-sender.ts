/*
 * A level sent as the operator moves it (X33, sound/SoundLevels.tsx): the first at once, then at most one each
 * LEVEL_SEND_MS while the slider moves, always ending on where it was let go. Each one reaches every screen and the
 * stream's page as the engine's state, so a drag never floods them, and each sound eases to its new level.
 */

/** The least time between two levels sent while a slider moves (ms). */
export const LEVEL_SEND_MS = 100;

/** The clock and the timer it waits with (the page's own; a test's in its tests). */
export interface SenderTimers {
  now(): number;
  after(ms: number, run: () => void): void;
}

const pageTimers: SenderTimers = {
  now: () => performance.now(),
  after: (ms, run) => {
    setTimeout(run, ms);
  },
};

/**
 * A sender of the latest value asked: at once when none went for `everyMs`; else, once that has passed, the last one
 * asked meanwhile (those between are never sent).
 */
export function latestSender(
  send: (value: number) => void,
  everyMs = LEVEL_SEND_MS,
  timers: SenderTimers = pageTimers,
): (value: number) => void {
  let lastAt = Number.NEGATIVE_INFINITY;
  let waiting: number | null = null;
  let timed = false;
  const go = () => {
    timed = false;
    if (waiting === null) return;
    const value = waiting;
    waiting = null;
    lastAt = timers.now();
    send(value);
  };
  return (value) => {
    waiting = value;
    if (timed) return;
    const wait = lastAt + everyMs - timers.now();
    if (wait <= 0) go();
    else {
      timed = true;
      timers.after(wait, go);
    }
  };
}
