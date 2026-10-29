import { atOrPastZero } from './audience-timer';
import type { ClockStyle } from './format';
import type { TimerElement } from './model';
import { flashDimmed, stageTimerText } from './stage-timer';
import { countsDown, type TimerState, timerValue } from './timers';

/*
 * A timer on a slide (Session 50) as Edit slides sets it since Session 55 (Part 15): its format, its warning colour
 * from a time left (an older slide's last minute is its warning from a minute left), its colour at zero, its slow
 * flash at zero, and what it shows at zero (its time, its message, or nothing). Pure functions of the element, the
 * timer and the engine's time, so every screen draws the same.
 */

/** Its warning: its own, else an older slide's last minute (a minute left), else none. */
export function slideTimerWarn(el: Pick<TimerElement, 'warn' | 'lastMinute'>): {
  fromMs: number;
  color: string;
} | null {
  if (el.warn) return el.warn;
  return el.lastMinute ? { fromMs: 60_000, color: el.lastMinute.color } : null;
}

/** Its colour at `now`, or null for its own: at zero and past it its colour then, else its warning's. */
export function slideTimerColor(
  el: Pick<TimerElement, 'warn' | 'lastMinute' | 'overColor'>,
  timer: TimerState | undefined,
  now: number,
): string | null {
  if (!timer || !countsDown(timer)) return null;
  const left = timerValue({ ...timer, allowsOverrun: true }, now);
  if (el.overColor !== undefined && left <= 0) return el.overColor;
  const warn = slideTimerWarn(el);
  return warn && left <= warn.fromMs ? warn.color : null;
}

/** What it shows at `now`: its time, its message at zero, or nothing at zero. */
export function slideTimerShows(
  el: Pick<TimerElement, 'atZero'>,
  timer: TimerState | undefined,
  now: number,
): 'time' | 'message' | 'gone' {
  if (!timer || (el.atZero !== 'message' && el.atZero !== 'gone') || !atOrPastZero(timer, now)) return 'time';
  return el.atZero;
}

/** Its time in its format (a clock as the clock style writes the time of day). */
export const slideTimerText = (
  el: Pick<TimerElement, 'format'>,
  timer: TimerState,
  now: number,
  style: ClockStyle | null | undefined,
): string => stageTimerText(timer, now, style, el.format ?? 'auto');

/** Whether its digits are dimmed for its flash at `now` (ten seconds at zero, as a stage timer box flashes). */
export const slideTimerDimmed = (
  el: Pick<TimerElement, 'flash'>,
  timer: TimerState | undefined,
  now: number,
): boolean => el.flash === true && flashDimmed(timer, now);
