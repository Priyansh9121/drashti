import { type ClockStyle, formatClock, formatDuration } from './format';
import type { StageBox, StageLayout, StageTimerFormat } from './stage-layouts';
import { countsDown, formatTimer, timerDuration, type TimerState, timerValue, zeroAt } from './timers';

/*
 * A stage layout's timer and clock boxes as they draw (Session 54), as pure functions of the box, the timer and
 * the engine's time, so this computer's stage screens, a node's, a tablet's stage page, the Stage panel's preview
 * and the layout editor all draw the same at the same moment (docs/design.md §40): the time in the box's format;
 * a countdown's colour from its warning time, and at 0:00 and past it; its slow flash at 0:00 (within the flash
 * rules, shared/flash.ts); and the clock in 12 or 24 hours, with the seconds or without.
 */

/**
 * A length in a timer box's format: as needed (5:00, 1:05:00), always minutes and seconds (65:00), or always the
 * hours too (0:05:00). Below zero signed ("-0:12"); `roundUp` for a countdown, so 0:00 shows only at the end.
 */
export function durationAs(ms: number, format: StageTimerFormat, roundUp: boolean): string {
  if (format === 'auto') return formatDuration(ms, { roundUp, signed: true });
  const negative = ms < 0;
  const away = Math.abs(ms);
  const whole = roundUp && !negative ? Math.ceil(away / 1000) : Math.floor(away / 1000);
  const s = String(whole % 60).padStart(2, '0');
  const body =
    format === 'mss'
      ? `${String(Math.floor(whole / 60))}:${s}`
      : `${String(Math.floor(whole / 3600))}:${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${s}`;
  return negative && whole > 0 ? `-${body}` : body;
}

/** A timer as a timer box writes it at `now`, in the box's format; a clock timer as the clock style writes the time. */
export function stageTimerText(
  timer: TimerState,
  now: number,
  style: ClockStyle | null | undefined,
  format: StageTimerFormat = 'auto',
): string {
  if (timer.kind === 'clock' || format === 'auto') return formatTimer(timer, now, style);
  return durationAs(timerValue(timer, now), format, timer.kind !== 'countup');
}

/**
 * A timer box's colour at `now`, or null for the box's own: a countdown's colour when over at 0:00 and past it,
 * else its warning's from that much left (1:00 left shows as the time turns 1:00). Never a count-up's or a clock's.
 */
export function stageTimerColor(
  box: Pick<StageBox, 'warn' | 'overColor'>,
  timer: TimerState | undefined,
  now: number,
): string | null {
  if (!timer || !countsDown(timer)) return null;
  const left = timerValue(timer, now);
  if (box.overColor !== undefined && left <= 0) return box.overColor;
  if (box.warn !== undefined && left <= box.warn.fromMs) return box.warn.color;
  return null;
}

/** How long a timer box flashes, from the first whole second of the engine's clock at or after its 0:00. */
export const FLASH_FOR_MS = 10_000;
/** Each step of the flash: the words dimmed on the engine clock's even seconds, whole on its odd ones. */
export const FLASH_STEP_MS = 1000;
/** The words' opacity while dimmed. */
export const FLASH_DIM = 0.25;

/**
 * Whether a flashing timer box's words are dimmed at `now`: for ten seconds from the first whole second of the
 * engine's clock at or after a countdown reached 0:00, on that clock's even seconds (five times, a second each).
 * Slow, as the flash rules ask (at most three swings of light a second; this makes one). In step with the engine
 * clock's whole seconds (Part A's review), not each timer's own 0:00, so several timers flash together and the
 * screen's light changes only as a second begins, however many flash: timed from each 0:00, they flashed out of
 * step. The first dim second comes within two of 0:00, which the colour when over marks at once. Never a count-up
 * or a clock, nor a countdown paused (it is then at no moment of its own).
 */
export function flashDimmed(timer: TimerState | undefined, now: number): boolean {
  if (!timer || !countsDown(timer)) return false;
  const zero = zeroAt(timer, now);
  if (zero === null) return false;
  const from = Math.ceil(zero / FLASH_STEP_MS) * FLASH_STEP_MS;
  return now >= from && now < from + FLASH_FOR_MS && Math.floor(now / FLASH_STEP_MS) % 2 === 0;
}

/** Each clock style's formatter for each way a clock box writes the time, made once (as format.ts's clocks are). */
const clockFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The time of day as a clock box writes it: as Drashti's computer does (formatClock) unless the box says 12 or
 * 24 hours (two figures for the hour, "07:05") or the seconds, in the clock style's language and time zone.
 */
export function stageClockText(
  ms: number,
  style: ClockStyle | null | undefined,
  box: Pick<StageBox, 'hours' | 'seconds'>,
): string {
  if (box.hours === undefined && box.seconds !== true) return formatClock(ms, style);
  const options: Intl.DateTimeFormatOptions = {
    hour: box.hours === 24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...(box.seconds === true ? { second: '2-digit' } : {}),
    ...(box.hours === undefined ? {} : { hourCycle: box.hours === 12 ? 'h12' : 'h23' }),
  };
  // This computer's own way follows a change of its time zone, so it is made each time, as formatClock's is.
  if (!style) return new Intl.DateTimeFormat([], options).format(ms);
  const key = `${style.locale}\n${style.timeZone}\n${String(box.hours)}\n${String(box.seconds === true)}`;
  let format = clockFormats.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(style.locale, { ...options, timeZone: style.timeZone });
    } catch {
      // A style this computer cannot write in: its own way, rather than no clock.
      format = new Intl.DateTimeFormat([], options);
    }
    clockFormats.set(key, format);
  }
  return format.format(ms);
}

// ---- the stage screens' timers, run from the Stage panel and the phone (Session 54, Part A3) ----------------

/**
 * The timers a stage layout's timer boxes show by name, each once, in the layout's order: what the Stage panel and
 * the phone start, pause and reset. None for the Standard stage screen, nor for a box of every running timer.
 */
export function layoutTimerIds(layout: Pick<StageLayout, 'boxes'> | null | undefined): string[] {
  const ids: string[] = [];
  for (const box of layout?.boxes ?? [])
    if (box.kind === 'timer' && box.timerId && !ids.includes(box.timerId)) ids.push(box.timerId);
  return ids;
}

/**
 * What a timer counts to or from, in words: "Counts down to 7:30 pm" (the time of day as the clock style writes
 * it, whatever the time zone: it is the time set), "Counts down from 5:00", "Counts up from 0:00"; null for a clock
 * or a countdown to no time.
 */
export function countsToWords(timer: TimerState, style: ClockStyle | null | undefined): string | null {
  switch (timer.kind) {
    case 'countdown':
      return `Counts down from ${timerDuration(timer.durationMs, false)}`;
    case 'countup':
      return 'Counts up from 0:00';
    case 'countdown_to_time': {
      const m = timer.targetTime === null ? null : /^(\d{1,2}):(\d{2})$/u.exec(timer.targetTime);
      if (!m) return null;
      // The time set, on a day of its own in UTC: written in the style's language (or this computer's), never
      // moved by a time zone.
      const at = Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]));
      const locale = style?.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
      return `Counts down to ${formatClock(at, { locale, timeZone: 'UTC' })}`;
    }
    case 'clock':
      return null;
  }
}
