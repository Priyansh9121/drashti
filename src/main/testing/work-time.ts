/*
 * The speed tests' clock (Session 58, h-flaky): how long this thread has worked, in ms. The speed tests time the main
 * process's own work against a budget (vitest.config.ts).
 */

/** This thread's working time so far, in ms: what the speed tests time their work by. */
export function workNow(): number {
  return performance.now();
}
