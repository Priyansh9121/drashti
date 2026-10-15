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
 *
 * The GPU's warm-up (Session 27, WarmUp.tsx) pauses it too, while it draws
 * every transition part-way before the page first draws the show: what it
 * draws then stays still, so the GPU draws it once instead of at every frame.
 * A test's hold comes first.
 */

let offset = 0;
/** The moment held, or null for the real clock. */
let held: number | null = null;
/** The warm-up's pause: the moment it draws, or null. */
let paused: number | null = null;
const listeners = new Set<() => void>();

/** The engine's time now (ms since the epoch). */
// eslint-disable-next-line no-restricted-properties -- the engine's clock itself: this computer's, plus how far Main's is from it
export const engineNow = (): number => held ?? paused ?? Date.now() + offset;

/**
 * The engine's time at the frame being drawn (Session 27; the skills review's MOT-7): what the page's own
 * animations (the ticker) are timed by, so the words land in their place even on a screen that draws few
 * frames a second. The engine's time now, less how long ago this frame began by the page's own frame
 * clock; held, the moment held. Before, it was the page's start (performance.timeOrigin) plus the frame's
 * time, which can drift from the computer's clock over a long sabha.
 */
export function engineFrameNow(): number {
  if (held !== null) return held;
  if (paused !== null) return paused;
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

/** The warm-up only: keep the clock at `ms` while it draws, or let it run again (null). */
export function pauseClock(ms: number | null): void {
  const next = ms !== null && Number.isFinite(ms) ? ms : null;
  if (next === paused) return;
  paused = next;
  for (const listener of listeners) listener();
}

/** Whether the clock is held (a test) or paused (the warm-up): the page's own animations stand still. */
export const clockHeld = (): boolean => held !== null || paused !== null;

/** Hear when the clock jumps (its offset set, or held or let go). */
export function onClockJump(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
