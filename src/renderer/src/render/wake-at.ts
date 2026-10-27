/*
 * A drawing asked for again when the engine's time reaches a moment (Session 54, C2): a deck's step on a phone turning
 * to its last frame as its clip ends, a deck's video losing its poster as it starts. The timer never decides a frame:
 * what is drawn is worked out from engineNow() when it wakes. A timer can wake a moment before the engine's time gets
 * there (by a millisecond, or a clock offset set meanwhile on a phone or a node): then it is armed again for the rest,
 * so the moment is never missed (until then, one woken early drew the same again and waited no more).
 */

/** Wake once the engine's time (`now`) is at `at` or past it; returns how to cancel. */
export function wakeAt(
  at: number,
  now: () => number,
  wake: () => void,
  // eslint-disable-next-line no-restricted-syntax -- never decides a frame: it only asks for a drawing (tests give their own)
  schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = (run, ms) => setTimeout(run, ms),
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    timer = schedule(
      () => {
        timer = null;
        if (now() < at) arm();
        else wake();
      },
      Math.max(0, at - now()) + 1,
    );
  };
  arm();
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
