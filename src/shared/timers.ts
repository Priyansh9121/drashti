import { z } from 'zod';
import { type ClockStyle, formatClock, formatDuration } from './format';

/*
 * Timers and the clock (PLAN.md 4.3). The engine keeps only when a timer
 * was started and how much it had counted before (start, pause and reset
 * are the only changes it sends); every window works out the time itself
 * from the shared clock, as with video, so nothing is sent every second.
 */

export type TimerKind = 'countdown' | 'countup' | 'countdown_to_time' | 'clock';
export const TIMER_KINDS = [
  'countdown',
  'countup',
  'countdown_to_time',
  'clock',
] as const satisfies readonly TimerKind[];

export const TIMER_KIND_NAMES: Record<TimerKind, string> = {
  countdown: 'Countdown',
  countup: 'Count up',
  countdown_to_time: 'Countdown to a time',
  clock: 'Clock',
};

export interface TimerDefinition {
  id: string;
  name: string;
  kind: TimerKind;
  /** Countdown: how long, in ms. */
  durationMs: number;
  /** Countdown to a time: the time of day, "HH:MM" (24-hour, the computer's local time). */
  targetTime: string | null;
  /** Keeps counting past zero (shown as -0:12) instead of stopping at 0:00. */
  allowsOverrun: boolean;
}

/** What starting, pausing and resetting change. */
export interface TimerRun {
  /** When it was last started (ms since the epoch, main-process clock), or null while stopped. */
  startedAt: number | null;
  /** Time counted before the last start: a pause keeps it, a reset clears it. */
  elapsedMs: number;
}

export type TimerState = TimerDefinition & TimerRun;

export const isRunning = (t: TimerRun): boolean => t.startedAt !== null;

/** Counted time at `now`. */
export function elapsedAt(t: TimerRun, now: number): number {
  return t.elapsedMs + (t.startedAt === null ? 0 : Math.max(0, now - t.startedAt));
}

/** Today's `HH:MM` in the computer's local time, as ms since the epoch. */
function todayAt(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/**
 * What a timer shows at `now`, in ms: time left for countdowns (below zero
 * only with overrun), time gone for a count-up, the time of day for a clock.
 */
export function timerValue(t: TimerState, now: number): number {
  switch (t.kind) {
    case 'countdown': {
      const left = t.durationMs - elapsedAt(t, now);
      return t.allowsOverrun ? left : Math.max(0, left);
    }
    case 'countup':
      return elapsedAt(t, now);
    case 'countdown_to_time': {
      const target = t.targetTime === null ? null : todayAt(t.targetTime, now);
      if (target === null) return 0;
      const left = target - now;
      return t.allowsOverrun ? left : Math.max(0, left);
    }
    case 'clock':
      return now;
  }
}

/** A timer's length: "4:05", "1:02:03" or "-0:12" (shared/format.ts). Countdowns round up, so 0:00 shows only at the end. */
export const timerDuration = (ms: number, roundUp: boolean): string =>
  formatDuration(ms, { roundUp, signed: true });

/**
 * A timer as the screens show it at `now`; a clock in Main's clock style (Sessions 31–36, I18N-8), so a node
 * in another time zone shows Main's time.
 */
export function formatTimer(t: TimerState, now: number, style?: ClockStyle | null): string {
  const value = timerValue(t, now);
  if (t.kind === 'clock') return formatClock(value, style);
  return timerDuration(value, t.kind !== 'countup');
}

// ---- a timer on a slide (Session 50) -------------------------------------------------------------

/** The kinds that count down to zero: a countdown, and a countdown to a time of day. */
export const countsDown = (t: Pick<TimerDefinition, 'kind'>): boolean =>
  t.kind === 'countdown' || t.kind === 'countdown_to_time';

/** Time left on a countdown at `now`, below zero too (whatever the timer shows); null for the other kinds. */
function leftAt(t: TimerState, now: number): number | null {
  if (t.kind === 'countdown') return t.durationMs - elapsedAt(t, now);
  if (t.kind === 'countdown_to_time') {
    const target = t.targetTime === null ? null : todayAt(t.targetTime, now);
    return target === null ? null : target - now;
  }
  return null;
}

/**
 * When what a timer shows next changes by itself, after `now` (the engine's clock), or null: it stands still
 * (stopped, paused, or held at 0:00). A clock changes at each minute; a countdown, a count-up and a countdown
 * to a time at each of their seconds. A slide's Timer draws again only then.
 */
export function changesAt(t: TimerState, now: number): number | null {
  if (t.kind === 'clock') return now + (60_000 - (now % 60_000));
  // A countdown to a time counts by the clock, started or not; the others only while they run.
  if (t.kind !== 'countdown_to_time' && t.startedAt === null) return null;
  if (t.kind === 'countup') return now + (1000 - (elapsedAt(t, now) % 1000));
  const left = leftAt(t, now);
  if (left === null) return null;
  // Rounded up: 0:05 shows until 4 s are left.
  if (left > 0) return now + (left - (Math.ceil(left / 1000) - 1) * 1000);
  if (!t.allowsOverrun) return null;
  const over = -left;
  return now + ((Math.floor(over / 1000) + 1) * 1000 - over);
}

/**
 * When what a timer shows last changed by itself, at or before `now`, or null: it has not since it was
 * started (or it does not run). A slide's Timer moves the digits that changed from then, so every screen
 * draws the same frame.
 */
export function changedAt(t: TimerState, now: number): number | null {
  if (t.kind === 'clock') return now - (now % 60_000);
  if (t.kind !== 'countdown_to_time' && t.startedAt === null) return null;
  let at: number;
  if (t.kind === 'countup') at = now - (elapsedAt(t, now) % 1000);
  else {
    const left = leftAt(t, now);
    if (left === null) return null;
    if (left > 0) at = now - (Math.ceil(left / 1000) * 1000 - left);
    else if (!t.allowsOverrun) at = now + left;
    else at = now - (-left - Math.floor(-left / 1000) * 1000);
  }
  return t.kind !== 'countdown_to_time' && t.startedAt !== null && at < t.startedAt ? null : at;
}

/** A countdown's last minute: a minute or less left, or past zero. Never a count-up's or a clock's. */
export const inLastMinute = (t: TimerState, now: number): boolean =>
  countsDown(t) && timerValue(t, now) <= 60_000;

/**
 * When a countdown reaches zero (the engine's clock), or null: a countdown stopped or paused, or a timer of
 * another kind. A countdown to a time of day reaches it at that time today, started or not: it counts by the
 * clock, as its digits do (Session 50, section 7's review).
 */
export function zeroAt(t: TimerState, now: number): number | null {
  if (t.kind === 'countdown_to_time') return t.targetTime === null ? null : todayAt(t.targetTime, now);
  if (t.startedAt === null) return null;
  if (t.kind === 'countdown') return t.startedAt + t.durationMs - t.elapsedMs;
  return null;
}

/** "5:00" or "1:30:00" to ms; null if it is not a duration. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  const [a = 0, b = 0, c = 0] = n;
  const seconds = n.length === 3 ? a * 3600 + b * 60 + c : n.length === 2 ? a * 60 + b : a * 60;
  return seconds * 1000;
}

// ---- checks for requests arriving over IPC ----------------------------------------

export const timerFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(TIMER_KINDS),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600 * 1000),
    targetTime: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    allowsOverrun: z.boolean(),
  })
  .strict();

export type TimerFields = Omit<TimerDefinition, 'id'>;

export type TimerResult = { ok: true; id: string } | { ok: false; message: string };
