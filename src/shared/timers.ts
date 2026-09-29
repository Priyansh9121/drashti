import { z } from 'zod';

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

/** "4:05", "1:02:03" or "-0:12". Countdowns round up, so 0:00 shows only at the end. */
export function formatDuration(ms: number, roundUp: boolean): string {
  const negative = ms < 0;
  const whole = roundUp && !negative ? Math.ceil(Math.abs(ms) / 1000) : Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const body =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return negative && whole > 0 ? `-${body}` : body;
}

/** A timer as the screens show it at `now`. */
export function formatTimer(t: TimerState, now: number): string {
  const value = timerValue(t, now);
  if (t.kind === 'clock')
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return formatDuration(value, t.kind !== 'countup');
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
