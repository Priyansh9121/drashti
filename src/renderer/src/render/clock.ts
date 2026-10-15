/*
 * The engine's clock, as this page knows it. Drashti's own windows run on the
 * computer the engine runs on, so the offset is 0. A phone, tablet or browser
 * on the network estimates how far its clock is from the engine's
 * (src/renderer/src/web/feed.ts) and sets it here, so timers, the clock,
 * dissolves and video positions agree with the screens.
 *
 * Tests only (Session 26d): an output can be held at one moment, so two
 * screens can be compared pixel for pixel part-way through a transition. The
 * main process sends that only under a test switch, never in a packaged
 * Drashti.
 */

let offset = 0;
/** The moment held, or null for the real clock. */
let held: number | null = null;
const listeners = new Set<() => void>();

/** The engine's time now (ms since the epoch). */
// eslint-disable-next-line no-restricted-properties -- the engine's clock itself: this computer's, plus how far Main's is from it
export const engineNow = (): number => held ?? Date.now() + offset;

/**
 * The engine's time at the frame being drawn (Session 27; the skills review's MOT-7): what the page's own
 * animations (the ticker) are timed by, so the words land in their place even on a screen that draws few
 * frames a second. The engine's time now, less how long ago this frame began by the page's own frame
 * clock; held, the moment held. Before, it was the page's start (performance.timeOrigin) plus the frame's
 * time, which can drift from the computer's clock over a long sabha.
 */
export function engineFrameNow(): number {
  if (held !== null) return held;
  const frame = Number(document.timeline.currentTime);
  if (!Number.isFinite(frame)) return engineNow();
  // eslint-disable-next-line no-restricted-properties -- how long ago this frame began, by the page's own frame clock: a length of time, not the time
  return engineNow() - Math.max(0, performance.now() - frame);
}

export function setClockOffset(ms: number): void {
  offset = Number.isFinite(ms) ? ms : 0;
  for (const listener of listeners) listener();
}

/** Tests only: hold the clock at `ms` (the engine's time), or let it run again (null). */
export function holdClock(ms: number | null): void {
  held = ms !== null && Number.isFinite(ms) ? ms : null;
  for (const listener of listeners) listener();
}

/** Whether the clock is held (tests only). */
export const clockHeld = (): boolean => held !== null;

/** Hear when the clock jumps (its offset set, or held or let go). */
export function onClockJump(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
