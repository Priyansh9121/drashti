/*
 * When a page's frames come on time (Session 27's warm-up rule, moved here in Session 58 for the warm-up's last step).
 * A GPU still making what the frames need, or a display compositor still drawing earlier ones, keeps the page's frames
 * waiting: on CI's Mac for seconds while the warm-up's pipelines are made; without a graphics chip, ~0.8 s a frame while
 * Chromium's software compositor draws the warm-up's (Session 58, h-black2: CI's Windows, traced). Frames that come on
 * time again say all of it has been drawn. Each frame is made a new one (`each` moves a speck), so it waits for the one
 * before it to be drawn.
 */

/** This many frames in a row on time. */
export const STEADY_FRAMES = 6;
/** On time: within this many ms of the frame before, or within twice the middle of every wait so far. */
export const ON_TIME_MS = 50;
/** The middle wait counts only once there are this many (the first waits are the longest). */
const MIDDLE_FROM = 10;

/** The frame source: the page's requestAnimationFrame (a test's own, in a unit test). */
export type FrameSource = (tick: (t: number) => void) => number;

/**
 * Resolves once the frames come on time, or once `maxMs` has gone by since the first (by the frames' own times, never a
 * clock of its own). `each` runs at every frame, given how many came before; `live` false ends it, never resolved (its
 * caller has gone); `keep` is told each frame's request, to cancel it.
 */
export function framesOnTime({
  maxMs,
  each,
  live,
  keep,
  frame = (tick) => requestAnimationFrame(tick),
}: {
  maxMs: number;
  each: (n: number) => void;
  live: () => boolean;
  keep: (request: number) => void;
  frame?: FrameSource;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    let steady = 0;
    let last: number | null = null;
    let first: number | null = null;
    const gaps: number[] = [];
    const tick = (t: number) => {
      if (!live()) return;
      first ??= t;
      each(gaps.length);
      if (last !== null) {
        const gap = t - last;
        gaps.push(gap);
        // The middle wait only once there are enough to say how this page draws (the first wait longest).
        const middle =
          gaps.length >= MIDDLE_FROM
            ? ([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0)
            : 0;
        steady = gap <= Math.max(ON_TIME_MS, 2 * middle) ? steady + 1 : 0;
      }
      last = t;
      if (steady < STEADY_FRAMES && t - first < maxMs) keep(frame(tick));
      else resolve();
    };
    keep(frame(tick));
  });
}
