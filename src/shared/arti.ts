import { z } from 'zod';
import { idSchema } from './model-schema';
import {
  daysSchema,
  dateSchema,
  hhmmSchema,
  nextScheduleTime,
  scheduleTimes,
  scheduleWhenText,
} from './schedule';
import type { ScheduleWhen } from './schedule';

// The days, dates and times are shared with the other schedules (shared/schedule.ts).
export { countdownText, localDate, WEEKDAY_NAMES, WEEKDAY_SHORT } from './schedule';

/*
 * The arti at its time (Session 12). An admin sets when each arti is: days
 * of the week and a time, or one date and a time, and which presentation is
 * the arti (its slides, with their sound and background). Some minutes
 * before, the operator window shows a prompt counting down; at the time the
 * arti becomes what Next shows, and the prompt asks "Put up Arti now" or
 * "Not now". It never goes up by itself unless its schedule says so, and
 * then only after a ten-second countdown the operator can cancel. A time
 * that passed while Drashti was closed is not run late.
 *
 * The times are this computer's local time, read from the main process's
 * clock, the one the engine counts with; the windows count down from the
 * times the main process gives them.
 */

/** The prompt shows at most this long before the time. */
export const ARTI_PROMPT_MAX_MINUTES = 60;
/** Unanswered, the prompt stays this long after the time, then goes. */
export const ARTI_LATE_MS = 10 * 60_000;
/** Going up by itself: the countdown the operator can cancel. */
export const ARTI_COUNTDOWN_MS = 10_000;
/**
 * Going up by itself only starts within this of the time; later (the
 * computer was asleep through it), the prompt asks instead.
 */
export const ARTI_BY_ITSELF_WITHIN_MS = 60_000;
export const ARTI_SCHEDULES_MAX = 50;

export interface ArtiSchedule {
  id: string;
  /** What the prompt calls it: "Evening arti". */
  name: string;
  /** The arti: a presentation, with its slides' sound and background. Null once it was removed for good. */
  presentationId: string | null;
  /** Every week on these days (0 Sunday … 6 Saturday); empty when it is on one date. */
  days: number[];
  /** On one date, "YYYY-MM-DD"; null when it is weekly. */
  date: string | null;
  /** "HH:MM", 24-hour, this computer's time. */
  time: string;
  /** The prompt shows this many minutes before the time (0: at the time). */
  promptMinutes: number;
  /** At the time it goes up by itself, after a ten-second countdown the operator can cancel. */
  byItself: boolean;
  /** Off: kept, but no prompt. */
  enabled: boolean;
}

export interface ArtiScheduleInfo extends ArtiSchedule {
  /** Its presentation's name, or null when the presentation is gone (it then never prompts). */
  presentationName: string | null;
  /** Its next time (ms, by the schedules' clock: this computer's), or null (off, gone, or a date passed). */
  nextAt: number | null;
}

export type ArtiFields = Omit<ArtiSchedule, 'id' | 'presentationId'> & { presentationId: string };

export const artiFieldsSchema = z
  .object({
    name: z.string().trim().min(1, 'Give it a name, for example “Evening arti”.').max(80),
    presentationId: idSchema,
    days: daysSchema,
    date: dateSchema.nullable(),
    time: hhmmSchema,
    promptMinutes: z.number().int().min(0).max(ARTI_PROMPT_MAX_MINUTES),
    byItself: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()
  .refine((f) => (f.date === null) !== (f.days.length === 0), {
    message: 'Choose the days of the week, or one date.',
  });

export const artiSaveSchema = z.object({ id: idSchema.nullable(), fields: artiFieldsSchema }).strict();
export const artiKeySchema = z.string().min(1).max(200);

export type ArtiResult = { ok: true; id: string } | { ok: false; message: string };

/** The prompt the operator window shows: one arti at a time. */
export interface ArtiPrompt {
  /** This time of this schedule ("<schedule id>@<time>"): what the answer is for. */
  key: string;
  scheduleId: string;
  name: string;
  presentationId: string;
  /** Its time as the schedule says it, "19:00". */
  time: string;
  /** Its time, in the main process's clock (the windows count down to it). */
  at: number;
  /** It goes up by itself at this time unless cancelled; null when it waits for the operator. */
  byItselfAt: number | null;
}

export interface ArtiView {
  schedules: ArtiScheduleInfo[];
  prompt: ArtiPrompt | null;
  /** How far the schedules' clock is ahead of the engine's: 0, except while a test moves it. */
  offsetMs: number;
}

export type ArtiAnswer = { ok: true } | { ok: false; message: string };

/** The schedule's times from `fromMs` up to (not including) `toMs`, in order (shared/schedule.ts). */
export const artiTimes = (s: ScheduleWhen, fromMs: number, toMs: number): number[] =>
  scheduleTimes(s, fromMs, toMs);

/** When a schedule next comes (its time), from `nowMs`; null if never (a date that has passed). */
export const nextArtiTime = (s: ScheduleWhen, nowMs: number): number | null => nextScheduleTime(s, nowMs);

/** When, in words: "Sun, Wed 19:00", "Every day 07:00", "2026-11-12 18:30". */
export const artiWhen = (s: ScheduleWhen): string => scheduleWhenText(s);
