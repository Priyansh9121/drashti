import { z } from 'zod';

/*
 * Times on a schedule (Session 12's arti, and since Session 14 scheduled
 * backups and macros): every week on chosen days, or on one date, at a time
 * of day, by this computer's local clock. A time is when it is on the
 * computer's clock, so a change to summer time moves nothing.
 */

/** The days of the week, as JavaScript numbers them (0 is Sunday). */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** When something happens: days of the week and a time, or one date and a time. */
export interface ScheduleWhen {
  /** Every week on these days (0 Sunday … 6 Saturday); empty when it is on one date. */
  days: number[];
  /** On one date, "YYYY-MM-DD"; null when it is weekly. */
  date: string | null;
  /** "HH:MM", 24-hour, this computer's time. */
  time: string;
}

export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Write the time as HH:MM, for example 19:00.');
export const daysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as YYYY-MM-DD.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00`)), 'That date does not exist.');

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date as "YYYY-MM-DD". */
export const localDate = (d: Date): string =>
  `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The schedule's times from `fromMs` up to (not including) `toMs`, in
 * order: ms since the epoch, at this computer's local time on each day.
 */
export function scheduleTimes(s: ScheduleWhen, fromMs: number, toMs: number): number[] {
  const m = /^(\d{2}):(\d{2})$/.exec(s.time);
  if (!m || toMs <= fromMs) return [];
  const [hours, minutes] = [Number(m[1]), Number(m[2])];
  const times: number[] = [];
  // A day either side, so a time near midnight (or across a clock change) is never missed.
  const day = new Date(fromMs);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  for (let i = 0; i < 400 && day.getTime() < toMs; i++) {
    const on = s.date === null ? s.days.includes(day.getDay()) : localDate(day) === s.date;
    if (on) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).getTime();
      if (at >= fromMs && at < toMs) times.push(at);
    }
    day.setDate(day.getDate() + 1);
  }
  return times;
}

/** When a schedule next comes (its time), from `nowMs`; null if never (a date that has passed). */
export function nextScheduleTime(s: ScheduleWhen, nowMs: number): number | null {
  // A weekly one comes within eight days; a date, whenever it is (up to a few years ahead).
  const horizon = s.date === null ? 8 : 4 * 366;
  return scheduleTimes(s, nowMs, nowMs + horizon * 24 * 3600 * 1000)[0] ?? null;
}

/** When, in words: "Sun, Wed 19:00", "Every day 07:00", "2026-11-12 18:30". */
export function scheduleWhenText(s: ScheduleWhen): string {
  if (s.date !== null) return `${s.date} ${s.time}`;
  if (s.days.length === 7) return `Every day ${s.time}`;
  return `${s.days.map((d) => WEEKDAY_SHORT[d] ?? '?').join(', ')} ${s.time}`;
}

/** "4:59" until the time; "0:00" once it is here. */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(sec)}` : `${String(m)}:${pad(sec)}`;
}
