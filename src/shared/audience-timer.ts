import {
  AUDIENCE_TIMER_SIZE,
  type AudienceTimerLook,
  DEFAULT_TIMER_LOOK,
  START_COUNTDOWN_LOOK,
  START_COUNTDOWN_NAME,
} from './timer-look';
import type { ClockStyle } from './format';
import { durationAs, FLASH_FOR_MS, FLASH_STEP_MS } from './stage-timer';
import {
  countsDown,
  formatTimer,
  type TimerDefinition,
  type TimerFields,
  type TimerState,
  timerValue,
  zeroAt,
} from './timers';

/*
 * Timers for the audience (Session 55, Part 15): one of the library's timers (a clock, a countdown, a countdown to a
 * time, a count up) on the hall's screens, full screen or in a corner, over the wallpaper or over what is up, with a
 * label above it ("Activity ends in", placeholder words), a ring or a bar of the time left, a warning colour and a
 * flash near the end, and what it does at zero: it stays, shows a message, shows the wallpaper, or goes by itself.
 * Each timer keeps its own look in the library; one at a time is up (the engine's `layers.timer`), started, paused,
 * reset, shown and hidden from Timers, the Stage screen panel and the phone. Countdown to the start (Q) is one of
 * these: the sabha's time, a countdown over the wallpaper on the audience and the stage, gone by itself at zero.
 * Every frame is a pure function of the timer, its look and the engine's time, so every screen draws the same.
 */

/** The timer Countdown to the start makes or changes: a countdown to the sabha's time, with its look. */
export function startCountdownFields(time: string): TimerFields {
  return {
    name: START_COUNTDOWN_NAME,
    kind: 'countdown_to_time',
    durationMs: 0,
    targetTime: time,
    allowsOverrun: false,
    look: START_COUNTDOWN_LOOK,
  };
}

/**
 * Whether the sabha's time ("19:30") has already come today at `now` (the computer's local time): a countdown to it
 * would go at once, so Countdown to the start says so instead.
 */
export function startTimeGone(time: string, now: number): boolean {
  const m = /^(\d{1,2}):(\d{2})$/u.exec(time);
  if (!m) return true;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime() <= now;
}

/** A timer's look: its own, or the default. */
export const lookOf = (t: Pick<TimerDefinition, 'look'> | undefined): AudienceTimerLook =>
  t?.look ?? DEFAULT_TIMER_LOOK;

/** The time's size as a share of the picture's height: a quarter full screen, a tenth in a corner, stepped. */
export function timeSize(look: Pick<AudienceTimerLook, 'place' | 'size'>, height: number): number {
  const base = look.place === 'full' ? 0.24 : 0.1;
  const step = Math.min(AUDIENCE_TIMER_SIZE.max, Math.max(AUDIENCE_TIMER_SIZE.min, Math.round(look.size)));
  return Math.round(height * base * 1.2 ** step);
}

/**
 * The share of the time left (1 at the start, 0 at zero), for a ring or a bar: a countdown's from its length; a
 * countdown to a time's from when it was shown (`shownAt`) to its time; null for a count up or a clock, which have
 * no end, and for a countdown to no time.
 */
export function timeLeftShare(t: TimerState, now: number, shownAt: number): number | null {
  if (!countsDown(t)) return null;
  const left = timerValue({ ...t, allowsOverrun: true }, now);
  let whole: number;
  if (t.kind === 'countdown') whole = t.durationMs;
  else {
    const zero = zeroAt(t, now);
    if (zero === null) return null;
    whole = zero - shownAt;
  }
  if (whole <= 0) return 0;
  return Math.min(1, Math.max(0, left / whole));
}

/** Whether a countdown is at or past zero at `now` (never a count up or a clock). */
export function atOrPastZero(t: TimerState, now: number): boolean {
  if (!countsDown(t)) return false;
  const zero = zeroAt(t, now);
  if (zero !== null) return now >= zero;
  // A countdown paused, or never started: its own time left.
  return t.kind === 'countdown' && t.durationMs - t.elapsedMs <= 0;
}

/** The colour of the time (and its ring or bar) at `now`: the warning's from its time left, else its own. */
export function timeColor(look: AudienceTimerLook, t: TimerState, now: number): string {
  if (!countsDown(t) || !look.warn) return look.color;
  return timerValue(t, now) <= look.warn.fromMs ? look.warn.color : look.color;
}

/**
 * Whether the time is dimmed for its flash at `now`: near the end (from its warning's time left, else the last 10
 * seconds) and for 10 seconds from zero, on the engine clock's even seconds, a second each (one swing of light a
 * second, within the flash rules, shared/flash.ts). Never a count up, a clock, a paused countdown, or a look
 * without its flash.
 */
export function timerDimmed(look: AudienceTimerLook, t: TimerState, now: number): boolean {
  if (!look.flash || !countsDown(t)) return false;
  const zero = zeroAt(t, now);
  if (zero === null) return false;
  const near = look.warn?.fromMs ?? FLASH_FOR_MS;
  const from = Math.ceil((zero - near) / FLASH_STEP_MS) * FLASH_STEP_MS;
  const until = Math.ceil(zero / FLASH_STEP_MS) * FLASH_STEP_MS + FLASH_FOR_MS;
  return now >= from && now < until && Math.floor(now / FLASH_STEP_MS) % 2 === 0;
}

/** What the timer draws at `now`: its time, its message at zero, the wallpaper alone, or nothing (gone). */
export type AudienceTimerShows = 'time' | 'message' | 'wallpaper' | 'gone';

export function audienceTimerShows(look: AudienceTimerLook, t: TimerState, now: number): AudienceTimerShows {
  if (look.atZero === 'stay' || !atOrPastZero(t, now)) return 'time';
  return look.atZero === 'message' ? 'message' : look.atZero;
}

/** The time as the look writes it: a clock as the clock style does, a length in the look's format. */
export function audienceTimerText(
  look: AudienceTimerLook,
  t: TimerState,
  now: number,
  style: ClockStyle | null | undefined,
): string {
  if (t.kind === 'clock' || look.format === 'auto') return formatTimer(t, now, style);
  return durationAs(timerValue(t, now), look.format, t.kind !== 'countup');
}

/**
 * When the engine takes a timer up off by itself (its look goes by itself at zero), by the engine's clock: its
 * zero, for a running countdown or a countdown to a time; null when it never does.
 */
export function goesAt(look: AudienceTimerLook, t: TimerState, now: number): number | null {
  if (look.atZero !== 'gone' || !countsDown(t)) return null;
  return zeroAt(t, now);
}

/** How long a timer for the audience fades in and out (ms): the same on every screen, from the engine's times. */
export const AUDIENCE_TIMER_FADE_MS = 400;
