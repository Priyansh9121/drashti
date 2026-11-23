/*
 * The log's days (alpha.21, logs for 100+ installs, the owner's "Yes, that plan"): the main process keeps one log file a
 * day, by this computer's own days (main/log.ts), 30 days. Save Diagnostics and Report a Problem take the log of a
 * chosen period from them: Today, Yesterday, the last 7 days, or one chosen day. A day is named YYYY-MM-DD in this
 * computer's time zone.
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

/** The periods with names; any other is one day, YYYY-MM-DD. */
export const NAMED_LOG_PERIODS = ['today', 'yesterday', 'last-7-days'] as const;
export type NamedLogPeriod = (typeof NAMED_LOG_PERIODS)[number];
/** The log of: Today, Yesterday, the last 7 days (today and the 6 before), or one day (YYYY-MM-DD). */
export type LogPeriod = NamedLogPeriod | `${number}-${number}-${number}`;

/** Red stubs (alpha.21, logs (c)): not yet. */
export function isLogPeriod(v: unknown): v is LogPeriod {
  return v === undefined;
}
export function periodDays(period: LogPeriod, now: number): string[] {
  return period === 'today' && now < 0 ? [] : [];
}
export function periodRange(period: LogPeriod, now: number): { from: number; to: number } {
  return { from: period === 'today' ? 0 : 0, to: now * 0 };
}
export function dayLabel(day: string, now: number): string {
  return now < 0 ? day : '';
}
export function periodText(period: LogPeriod, now: number): string {
  return now < 0 ? period : '';
}
export function periodChoices(kept: readonly string[], now: number): { period: LogPeriod; label: string }[] {
  return now < 0 ? kept.map((d) => ({ period: d as LogPeriod, label: d })) : [];
}
