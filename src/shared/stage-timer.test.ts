import { describe, expect, it } from 'vitest';
import { swings } from './flash';
import { type ClockStyle, formatClock } from './format';
import { newStageBox } from './stage-layouts';
import {
  countsToWords,
  durationAs,
  FLASH_DIM,
  FLASH_FOR_MS,
  flashDimmed,
  layoutTimerIds,
  stageClockText,
  stageTimerColor,
  stageTimerText,
} from './stage-timer';
import type { TimerState } from './timers';

/* A stage layout's timer and clock boxes as they draw (Session 54): from the box, the timer and the engine's time. */

const countdown: TimerState = {
  id: 'placeholder-countdown',
  name: 'Placeholder countdown',
  kind: 'countdown',
  durationMs: 5 * 60_000,
  targetTime: null,
  allowsOverrun: true,
  startedAt: null,
  elapsedMs: 0,
};

const UTC: ClockStyle = { locale: 'en-GB', timeZone: 'UTC' };

describe('a timer box’s format', () => {
  it('writes a length as needed, in minutes and seconds, or with the hours always', () => {
    expect(durationAs(65 * 60_000, 'auto', true)).toBe('1:05:00');
    expect(durationAs(65 * 60_000, 'mss', true)).toBe('65:00');
    expect(durationAs(65 * 60_000, 'hmmss', true)).toBe('1:05:00');
    expect(durationAs(5 * 60_000, 'auto', true)).toBe('5:00');
    expect(durationAs(5 * 60_000, 'mss', true)).toBe('5:00');
    expect(durationAs(5 * 60_000, 'hmmss', true)).toBe('0:05:00');
    // A countdown rounds up, so 0:00 shows only at the end; below zero it is signed, rounded down.
    expect(durationAs(500, 'mss', true)).toBe('0:01');
    expect(durationAs(-500, 'mss', true)).toBe('0:00');
    expect(durationAs(-12_400, 'mss', true)).toBe('-0:12');
    expect(durationAs(-3_725_000, 'hmmss', true)).toBe('-1:02:05');
    // A count-up rounds down.
    expect(durationAs(59_999, 'hmmss', false)).toBe('0:00:59');
  });

  it('is the timer’s own time in each format; a clock timer stays a clock', () => {
    const long = { ...countdown, durationMs: 90 * 60_000 };
    expect(stageTimerText(long, 0, UTC)).toBe('1:30:00');
    expect(stageTimerText(long, 0, UTC, 'auto')).toBe('1:30:00');
    expect(stageTimerText(long, 0, UTC, 'mss')).toBe('90:00');
    expect(stageTimerText(countdown, 0, UTC, 'hmmss')).toBe('0:05:00');
    const running = { ...countdown, startedAt: 1_000 };
    expect(stageTimerText(running, 1_000 + 5 * 60_000 + 12_000, UTC, 'mss')).toBe('-0:12');
    const up = { ...countdown, kind: 'countup' as const, startedAt: 0 };
    expect(stageTimerText(up, 61_500, UTC, 'hmmss')).toBe('0:01:01');
    const clock = { ...countdown, kind: 'clock' as const };
    const at = Date.UTC(2026, 9, 27, 19, 5, 0);
    expect(stageTimerText(clock, at, UTC, 'mss')).toBe(formatClock(at, UTC));
  });
});

describe('a timer box’s colours', () => {
  const box = { warn: { color: '#f5a524', fromMs: 60_000 }, overColor: '#ef4444' };
  const running = { ...countdown, startedAt: 0 };

  it('are its own until the warning’s time left, the warning’s until 0:00, then the colour when over', () => {
    expect(stageTimerColor(box, running, 0)).toBeNull();
    expect(stageTimerColor(box, running, 4 * 60_000 - 1)).toBeNull();
    // 1:00 left, as the time shows it (rounded up): the warning.
    expect(stageTimerColor(box, running, 4 * 60_000)).toBe('#f5a524');
    expect(stageTimerColor(box, running, 5 * 60_000 - 1)).toBe('#f5a524');
    // 0:00, and on past it.
    expect(stageTimerColor(box, running, 5 * 60_000)).toBe('#ef4444');
    expect(stageTimerColor(box, running, 7 * 60_000)).toBe('#ef4444');
    // Held at 0:00: over too.
    expect(stageTimerColor(box, { ...running, allowsOverrun: false }, 7 * 60_000)).toBe('#ef4444');
  });

  it('are left out when the box has none, and change nothing of a count-up or a clock', () => {
    expect(stageTimerColor({}, running, 7 * 60_000)).toBeNull();
    expect(stageTimerColor({ warn: box.warn }, running, 7 * 60_000)).toBe('#f5a524');
    expect(stageTimerColor({ overColor: '#ef4444' }, running, 4.5 * 60_000)).toBeNull();
    expect(stageTimerColor(box, { ...running, kind: 'countup' }, 99 * 60_000)).toBeNull();
    expect(stageTimerColor(box, { ...running, kind: 'clock' }, 99 * 60_000)).toBeNull();
    expect(stageTimerColor(box, undefined, 0)).toBeNull();
  });

  it('follow a countdown to a time of day by the clock', () => {
    const at = new Date(2026, 9, 27, 19, 30, 0, 0).getTime();
    const to = {
      ...countdown,
      kind: 'countdown_to_time' as const,
      targetTime: '19:30',
      allowsOverrun: false,
    };
    expect(stageTimerColor(box, to, at - 2 * 60_000)).toBeNull();
    expect(stageTimerColor(box, to, at - 30_000)).toBe('#f5a524');
    expect(stageTimerColor(box, to, at + 1)).toBe('#ef4444');
  });
});

describe('a timer box’s flash at 0:00', () => {
  const running = { ...countdown, startedAt: 0 };
  const zero = 5 * 60_000;

  it('dims the words the first second of every two, for ten seconds from 0:00', () => {
    expect(flashDimmed(running, zero - 1)).toBe(false);
    expect(flashDimmed(running, zero)).toBe(true);
    expect(flashDimmed(running, zero + 999)).toBe(true);
    expect(flashDimmed(running, zero + 1000)).toBe(false);
    expect(flashDimmed(running, zero + 2000)).toBe(true);
    expect(flashDimmed(running, zero + 8999)).toBe(true);
    expect(flashDimmed(running, zero + FLASH_FOR_MS - 1)).toBe(false);
    expect(flashDimmed(running, zero + FLASH_FOR_MS)).toBe(false);
    expect(flashDimmed(running, zero + 60 * 60_000)).toBe(false);
    expect(FLASH_DIM).toBeGreaterThan(0);
    expect(FLASH_DIM).toBeLessThan(1);
  });

  it('only while a countdown runs to its 0:00: never paused, nor a count-up or a clock', () => {
    expect(flashDimmed({ ...countdown, elapsedMs: zero }, zero)).toBe(false);
    expect(flashDimmed({ ...running, kind: 'countup' }, zero)).toBe(false);
    expect(flashDimmed({ ...running, kind: 'clock' }, zero)).toBe(false);
    expect(flashDimmed(undefined, zero)).toBe(false);
    // Held at 0:00 (no overrun): it flashes as it gets there.
    expect(flashDimmed({ ...running, allowsOverrun: false }, zero + 500)).toBe(true);
  });

  it('keeps within the flash rules: a swing of light a second at most, where three are allowed', () => {
    // A timer's white digits over a fifth of the screen, sampled 60 times a second from 2 s before 0:00 to 14 s
    // after: the light of the screen, the words dimmed or whole.
    const series: number[] = [];
    for (let i = -120; i < 14 * 60; i++)
      series.push(0.2 * (flashDimmed(running, zero + (i * 1000) / 60) ? FLASH_DIM : 1));
    const found = swings(series, 60);
    expect(found.legs).toBe(10);
    expect(found.worst).toBeLessThanOrEqual(1);
  });
});

describe('a clock box', () => {
  const at = Date.UTC(2026, 9, 27, 19, 5, 9);

  it('writes the time as Drashti’s computer does unless the box says 12 or 24 hours, or the seconds', () => {
    expect(stageClockText(at, UTC, {})).toBe(formatClock(at, UTC));
    expect(stageClockText(at, UTC, { hours: 24 })).toBe('19:05');
    expect(stageClockText(at, UTC, { hours: 24, seconds: true })).toBe('19:05:09');
    expect(stageClockText(at, UTC, { hours: 12 })).toMatch(/^7:05\s?pm$/iu);
    expect(stageClockText(at, UTC, { hours: 12, seconds: true })).toMatch(/^7:05:09\s?pm$/iu);
    expect(stageClockText(at, UTC, { seconds: true })).toMatch(/^19:05:09$|^7:05:09\s?pm$/iu);
    // In the clock style's own time zone, as every screen writes Main's time.
    expect(stageClockText(at, { locale: 'en-GB', timeZone: 'Asia/Kolkata' }, { hours: 24 })).toBe('00:35');
  });
});

// Session 54 (Part A3): the Stage panel and the phone run the timers the stage screens' layout shows.
describe('the stage screens’ timers', () => {
  it('are those the layout’s timer boxes show by name, each once, in the layout’s order', () => {
    const timer = (id: string, timerId: string | null) => ({ ...newStageBox('timer', id), timerId });
    expect(layoutTimerIds(null)).toEqual([]);
    expect(layoutTimerIds(undefined)).toEqual([]);
    expect(
      layoutTimerIds({
        boxes: [
          newStageBox('audience', 'hall'),
          timer('a', 'second'),
          timer('b', null),
          newStageBox('clock', 'clock'),
          timer('c', 'first'),
          timer('d', 'second'),
        ],
      }),
    ).toEqual(['second', 'first']);
    // Every running timer is no one timer to run.
    expect(layoutTimerIds({ boxes: [timer('b', null)] })).toEqual([]);
  });

  it('say what each counts to, in Drashti’s computer’s way of writing the time', () => {
    expect(countsToWords(countdown, UTC)).toBe('Counts down from 5:00');
    expect(countsToWords({ ...countdown, kind: 'countup' }, UTC)).toBe('Counts up from 0:00');
    const to = { ...countdown, kind: 'countdown_to_time' as const, targetTime: '19:30' };
    // As Drashti's computer writes the time: en-GB in 24 hours, en-US in 12.
    expect(countsToWords(to, UTC)).toBe('Counts down to 19:30');
    expect(countsToWords(to, { locale: 'en-US', timeZone: 'Asia/Kolkata' })).toMatch(
      /^Counts down to 7:30\s?PM$/u,
    );
    expect(countsToWords(to, { locale: 'de-DE', timeZone: 'UTC' })).toBe('Counts down to 19:30');
    expect(countsToWords({ ...to, targetTime: null }, UTC)).toBeNull();
    expect(countsToWords({ ...countdown, kind: 'clock' }, UTC)).toBeNull();
  });
});
