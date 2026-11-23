/*
 * The log's days (alpha.21, logs for 100+ installs, the owner's "Yes, that plan"): the main process keeps one log file a
 * day, by this computer's own days (main/log.ts), 30 days. A day is named YYYY-MM-DD in this computer's time zone.
 */

const two = (n: number) => String(n).padStart(2, '0');

/** The day a moment falls on, in this computer's time zone: YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** When the day after the one this moment falls on begins (this computer's midnight), in ms. */
export function nextDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
