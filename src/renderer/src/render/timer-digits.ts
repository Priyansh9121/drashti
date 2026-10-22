import type { ClockStyle } from '../../../shared/format';
import type { Movement } from '../../../shared/looks';
import type { TimerElement } from '../../../shared/model';
import { changedAt, formatTimer, inLastMinute, type TimerState } from '../../../shared/timers';
import { EASE, lerp, seg } from './easing';

/*
 * A Timer on a slide as the screens draw it (Session 50), as pure functions of the timer and the engine's
 * time, so every screen draws the same frame: its time as cells, one a character, kept from the right (the
 * seconds keep their place as the minutes grow or shrink); only the digits that changed move, from the moment
 * they changed: in a Calm Look each fades to the next, in a Bold Look it rolls up (the Look's Movement,
 * Session 27). Stage screens cut, as ever (render/TimerText.tsx).
 */

/** One character of a time as drawn: its cell's key (from the right), what it is, and what it was if it changed. */
export interface DigitCell {
  key: number;
  char: string;
  was: string | null;
}

/** A time's cells, left to right, each changed one with the character it was (`was`: the time before). */
export function digitCells(now: string, was: string | null): DigitCell[] {
  const n = Math.max(now.length, was?.length ?? 0);
  const cells: DigitCell[] = [];
  for (let key = n - 1; key >= 0; key--) {
    const char = now[now.length - 1 - key] ?? '';
    const old = was === null ? null : (was[was.length - 1 - key] ?? '');
    cells.push({ key, char, was: old !== null && old !== char ? old : null });
  }
  return cells;
}

/** How long a digit takes to change: Calm fades it in 300 ms; Bold rolls it up in 400. */
export const digitLength = (movement: Movement): number => (movement === 'bold' ? 400 : 300);

/** How far a digit rolls in a Bold Look, in em: the new one rises from below as the old one rises away. */
export const DIGIT_ROLL = 0.6;

export interface DigitFrame {
  /** The new digit: its opacity, and how far below its place it still is (em). */
  in: { opacity: number; rise: number };
  /** The old digit: its opacity, and how far above its place it has gone (em, up is negative). */
  out: { opacity: number; rise: number };
}

/** A changed digit `t` ms after it changed: the new one in, the old one out, the two adding up to one. */
export function digitFrame(movement: Movement, t: number): DigitFrame {
  const length = digitLength(movement);
  if (movement !== 'bold') {
    const p = seg(t, 0, length, EASE.smooth);
    return { in: { opacity: p, rise: 0 }, out: { opacity: 1 - p, rise: 0 } };
  }
  const p = seg(t, 0, length, EASE.inOut);
  return {
    in: { opacity: p, rise: lerp(DIGIT_ROLL, 0, p) },
    out: { opacity: 1 - p, rise: p > 0 ? -DIGIT_ROLL * p : 0 },
  };
}

/** A timer as a slide draws it at `now`: its time, its cells, and when its digits began to change (null: still). */
export interface DrawnTime {
  text: string;
  cells: DigitCell[];
  changing: number | null;
}

/** What a slide's Timer draws at `now`; a timer no longer there shows --:--, as a message's does. */
export function drawnTime(
  timer: TimerState | undefined,
  now: number,
  style: ClockStyle | null,
  movement: Movement,
): DrawnTime {
  if (!timer) return { text: '--:--', cells: digitCells('--:--', null), changing: null };
  const text = formatTimer(timer, now, style);
  const at = changedAt(timer, now);
  const was = at !== null && now - at < digitLength(movement) ? formatTimer(timer, at - 1, style) : null;
  if (was === null || was === text) return { text, cells: digitCells(text, null), changing: null };
  return { text, cells: digitCells(text, was), changing: at };
}

/** The colour of a countdown's last minute, when the element has one and it is that minute; else null. */
export function lastMinuteColor(
  el: Pick<TimerElement, 'lastMinute'>,
  timer: TimerState | undefined,
  now: number,
): string | null {
  return el.lastMinute && timer && inLastMinute(timer, now) ? el.lastMinute.color : null;
}
