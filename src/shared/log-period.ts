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

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A day's first moment (this computer's midnight), or null when it is not a day. */
function startOf(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayOf(d.getTime()) === day ? d.getTime() : null;
}

/** The day `n` days before (or after, negative) the day of this moment. */
function dayBefore(ms: number, n: number): string {
  const d = new Date(ms);
  return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime());
}

/** The periods with names; any other is one day, YYYY-MM-DD. */
export const NAMED_LOG_PERIODS = ['today', 'yesterday', 'last-7-days'] as const;
export type NamedLogPeriod = (typeof NAMED_LOG_PERIODS)[number];
/** The log of: Today, Yesterday, the last 7 days (today and the 6 before), or one day (YYYY-MM-DD). */
export type LogPeriod = NamedLogPeriod | `${number}-${number}-${number}`;

/** Whether this is a period (a window's or a menu's, checked before it is used). */
export function isLogPeriod(v: unknown): v is LogPeriod {
  return (
    typeof v === 'string' && ((NAMED_LOG_PERIODS as readonly string[]).includes(v) || startOf(v) !== null)
  );
}

/** The period's days, oldest first. */
export function periodDays(period: LogPeriod, now: number): string[] {
  switch (period) {
    case 'today':
      return [dayOf(now)];
    case 'yesterday':
      return [dayBefore(now, 1)];
    case 'last-7-days':
      return [6, 5, 4, 3, 2, 1, 0].map((n) => dayBefore(now, n));
    default:
      return startOf(period) === null ? [] : [period];
  }
}

/** The period from its first day's start to its last day's end, in ms (an error line's time is within it). */
export function periodRange(period: LogPeriod, now: number): { from: number; to: number } {
  const days = periodDays(period, now);
  const from = startOf(days[0] ?? '') ?? now;
  const last = startOf(days.at(-1) ?? '') ?? now;
  return { from, to: nextDayStart(last) };
}

/** A day as a person reads it: "Sat 21 Nov", with its year when it is not this one's. */
export function dayLabel(day: string, now: number): string {
  const start = startOf(day);
  if (start === null) return day;
  const d = new Date(start);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const words = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return words.replace(/,/gu, '');
}

/** The period in a diagnostics file's words: "Today, 2026-11-23"; "The last 7 days, 2026-11-17 to 2026-11-23". */
export function periodText(period: LogPeriod, now: number): string {
  const days = periodDays(period, now);
  const first = days[0] ?? '';
  switch (period) {
    case 'today':
      return `Today, ${first}`;
    case 'yesterday':
      return `Yesterday, ${first}`;
    case 'last-7-days':
      return `The last 7 days, ${first} to ${days.at(-1) ?? ''}`;
    default:
      return `One day, ${first}`;
  }
}

/** The choices a window offers for the kept days (newest first): the named three, then each earlier kept day. */
export function periodChoices(kept: readonly string[], now: number): { period: LogPeriod; label: string }[] {
  const today = dayOf(now);
  const yesterday = dayBefore(now, 1);
  return [
    { period: 'today', label: 'Today' },
    { period: 'yesterday', label: 'Yesterday' },
    { period: 'last-7-days', label: 'The last 7 days' },
    ...kept
      .filter((d) => d !== today && d !== yesterday && isLogPeriod(d))
      .map((d) => ({ period: d as LogPeriod, label: dayLabel(d, now) })),
  ];
}
