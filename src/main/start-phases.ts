/*
 * The start's phase lines (Sessions 31–36, PERF-1): how long after this process began each part of the
 * start was ready, in the log ("Start: library open at 812 ms"): the main process running, the library
 * open, the engine ready with whatever was put back, the operator window shown, and each output's first
 * painted frame with its revision. A crash's recovery is read from them (tests/e2e/recovery-figure.ts).
 */

/** Ms since this process began. */
export const sinceStart = (): number => Math.round(process.uptime() * 1000);

/** When this process began, on this computer's clock (ms since the epoch). */
export const processStartedAt = (): number => Date.now() - process.uptime() * 1000;

/** A phase line: `what` at the time since the process began (now, or the moment given on this computer's clock). */
export function phaseLine(what: string, at?: number): string {
  const ms = at === undefined ? sinceStart() : Math.round(at - processStartedAt());
  return `Start: ${what} at ${String(ms)} ms`;
}
