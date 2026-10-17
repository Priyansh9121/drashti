import { describe, expect, it } from 'vitest';
import type { TimerState } from './timers';
import { formatTimer, parseDuration, timerDuration, timerValue } from './timers';

const base: TimerState = {
  id: 't',
  name: 'Placeholder',
  kind: 'countdown',
  durationMs: 5 * 60_000,
  targetTime: null,
  allowsOverrun: false,
  startedAt: null,
  elapsedMs: 0,
};

describe('timers', () => {
  it('count down from when they were started, keeping what a pause counted', () => {
    const running = { ...base, startedAt: 10_000 };
    expect(formatTimer(running, 10_000)).toBe('5:00');
    expect(formatTimer(running, 10_001)).toBe('5:00');
    expect(formatTimer(running, 11_000)).toBe('4:59');
    const paused = { ...base, elapsedMs: 61_000 };
    expect(formatTimer(paused, 99_999_999)).toBe('3:59');
    expect(formatTimer({ ...paused, startedAt: 200_000 }, 202_500)).toBe('3:57');
  });

  it('stop at 0:00, or run on below zero with overrun', () => {
    const done = { ...base, startedAt: 0 };
    expect(formatTimer(done, 6 * 60_000)).toBe('0:00');
    expect(formatTimer({ ...done, allowsOverrun: true }, 5 * 60_000 + 12_000)).toBe('-0:12');
  });

  it('count up, and count down to a time of day', () => {
    expect(formatTimer({ ...base, kind: 'countup', startedAt: 0 }, 3_725_900)).toBe('1:02:05');
    const at = new Date(2026, 8, 29, 19, 25, 0).getTime();
    const toTime = { ...base, kind: 'countdown_to_time' as const, targetTime: '19:30' };
    expect(formatTimer(toTime, at)).toBe('5:00');
    expect(timerValue(toTime, at + 10 * 60_000)).toBe(0);
  });

  it('writes and reads durations', () => {
    expect(timerDuration(59_000, false)).toBe('0:59');
    expect(timerDuration(3_600_000, false)).toBe('1:00:00');
    expect(timerDuration(-12_000, true)).toBe('-0:12');
    expect(parseDuration('5:00')).toBe(300_000);
    expect(parseDuration('1:30:00')).toBe(5_400_000);
    expect(parseDuration('10')).toBe(600_000);
    expect(parseDuration('5:x')).toBeNull();
  });

  it('a clock shows the time as Main writes it, its locale and time zone, wherever it is drawn (Sessions 31–36, I18N-8)', () => {
    const clock = { ...base, kind: 'clock' as const };
    // 19:00 UTC: 0:30 the next day in Kolkata, 8:45 in Chatham (its summer time).
    const at = Date.UTC(2026, 9, 16, 19, 0);
    expect(formatTimer(clock, at, { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe('0:30');
    expect(formatTimer(clock, at, { locale: 'en-GB', timeZone: 'Pacific/Chatham' })).toBe('8:45');
    expect(formatTimer(clock, at, { locale: 'en-US', timeZone: 'Pacific/Chatham' })).toMatch(/^8:45\sAM$/u);
  });
});
