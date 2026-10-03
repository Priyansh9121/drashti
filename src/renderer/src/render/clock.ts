/*
 * The engine's clock, as this page knows it. Drashti's own windows run on the
 * computer the engine runs on, so the offset is 0. A phone, tablet or browser
 * on the network estimates how far its clock is from the engine's
 * (src/renderer/src/web/feed.ts) and sets it here, so timers, the clock,
 * dissolves and video positions agree with the screens.
 */

let offset = 0;

/** The engine's time now (ms since the epoch). */
export const engineNow = (): number => Date.now() + offset;

export function setClockOffset(ms: number): void {
  offset = Number.isFinite(ms) ? ms : 0;
}
