import { describe, expect, it } from 'vitest';
import type { TimerState } from './timers';
import {
  changedAt,
  changesAt,
  countsDown,
  formatTimer,
  inLastMinute,
  parseDuration,
  timerDuration,
  timerValue,
  zeroAt,
} from './timers';

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

/*
 * A Timer on a slide (Session 50): what each kind shows, when what it shows changes by itself (each screen
 * draws again only then, and moves only the digits that changed from that moment), its last minute, and when
 * a countdown reaches zero (a slide that goes on at zero).
 */
describe('a timer on a slide', () => {
  const countdown: TimerState = { ...base, startedAt: 10_000 };

  it('shows each kind of timer as a message and the stage screens do', () => {
    expect(formatTimer(countdown, 10_000 + 61_500)).toBe('3:59');
    expect(formatTimer({ ...base, kind: 'countup', startedAt: 0, elapsedMs: 5000 }, 2_250)).toBe('0:07');
    const at = new Date(2026, 8, 29, 19, 25, 0).getTime();
    expect(formatTimer({ ...base, kind: 'countdown_to_time', targetTime: '19:30' }, at + 30_500)).toBe(
      '4:30',
    );
    expect(
      formatTimer({ ...base, kind: 'clock' }, Date.UTC(2026, 9, 16, 19, 7), {
        locale: 'en-GB',
        timeZone: 'UTC',
      }),
    ).toBe('19:07');
  });

  it('a countdown changes at each of its own seconds, and stands still at 0:00 or while it is stopped', () => {
    // 4.5 s gone of 5:00: it shows 4:56 until 5 s have gone.
    expect(formatTimer(countdown, 14_500)).toBe('4:56');
    expect(changesAt(countdown, 14_500)).toBe(15_000);
    expect(formatTimer(countdown, 15_000)).toBe('4:55');
    expect(changedAt(countdown, 15_000)).toBe(15_000);
    expect(changedAt(countdown, 15_999)).toBe(15_000);
    expect(changesAt(countdown, 15_000)).toBe(16_000);
    // Started part-way through a second (a pause kept 0.25 s): its seconds are its own.
    const resumed = { ...base, startedAt: 20_000, elapsedMs: 250 };
    expect(changesAt(resumed, 20_000)).toBe(20_750);
    // Nothing has changed by itself since it started.
    expect(changedAt(resumed, 20_500)).toBeNull();
    expect(changedAt(resumed, 20_750)).toBe(20_750);
    // At zero: 0:00 arrives, and then nothing changes.
    expect(changedAt(countdown, 310_000)).toBe(310_000);
    expect(changesAt(countdown, 310_000)).toBeNull();
    expect(changedAt(countdown, 400_000)).toBe(310_000);
    // Below zero with overrun: each second past it.
    const over = { ...countdown, allowsOverrun: true };
    expect(changesAt(over, 310_000)).toBe(311_000);
    expect(formatTimer(over, 311_000)).toBe('-0:01');
    expect(changedAt(over, 311_400)).toBe(311_000);
    // Stopped or paused: it stands still.
    expect(changesAt(base, 99_000)).toBeNull();
    expect(changedAt({ ...base, elapsedMs: 61_000 }, 99_000)).toBeNull();
  });

  it('a count-up, a countdown to a time and a clock change at their seconds and minutes', () => {
    const up = { ...base, kind: 'countup' as const, startedAt: 1000, elapsedMs: 300 };
    expect(changesAt(up, 2_000)).toBe(2_700);
    expect(changedAt(up, 2_000)).toBe(1_700);
    expect(changedAt(up, 1_500)).toBeNull();
    const at = new Date(2026, 8, 29, 19, 25, 0).getTime();
    const toTime = { ...base, kind: 'countdown_to_time' as const, targetTime: '19:30' };
    // A countdown to a time changes at the computer's own seconds, running or not.
    expect(changesAt(toTime, at + 250)).toBe(at + 1000);
    expect(changedAt(toTime, at + 250)).toBe(at);
    // At the time, 0:00, and then it holds.
    expect(changedAt(toTime, at + 6 * 60_000)).toBe(at + 5 * 60_000);
    expect(changesAt(toTime, at + 6 * 60_000)).toBeNull();
    const clock = { ...base, kind: 'clock' as const };
    const seven = Date.UTC(2026, 9, 16, 19, 7, 20);
    expect(changesAt(clock, seven)).toBe(Date.UTC(2026, 9, 16, 19, 8));
    expect(changedAt(clock, seven)).toBe(Date.UTC(2026, 9, 16, 19, 7));
  });

  it('the last minute is a minute or less left on a countdown, past zero too; never a count-up or a clock', () => {
    expect(inLastMinute(countdown, 10_000 + 239_999)).toBe(false);
    expect(inLastMinute(countdown, 10_000 + 240_000)).toBe(true);
    expect(inLastMinute(countdown, 10_000 + 400_000)).toBe(true);
    expect(inLastMinute({ ...base, durationMs: 45_000 }, 0)).toBe(true);
    expect(inLastMinute({ ...base, kind: 'countup', startedAt: 0 }, 1000)).toBe(false);
    expect(inLastMinute({ ...base, kind: 'clock' }, 1000)).toBe(false);
    const at = new Date(2026, 8, 29, 19, 29, 30).getTime();
    expect(inLastMinute({ ...base, kind: 'countdown_to_time', targetTime: '19:30' }, at)).toBe(true);
  });

  it('a running countdown reaches zero at a known moment; one stopped, or another kind, never does', () => {
    expect(zeroAt(countdown, 0)).toBe(310_000);
    expect(zeroAt({ ...countdown, elapsedMs: 60_000 }, 0)).toBe(250_000);
    expect(zeroAt(base, 0)).toBeNull();
    expect(zeroAt({ ...base, kind: 'countup', startedAt: 0 }, 0)).toBeNull();
    const at = new Date(2026, 8, 29, 19, 25, 0).getTime();
    const toTime = { ...base, kind: 'countdown_to_time' as const, targetTime: '19:30', startedAt: at };
    expect(zeroAt(toTime, at)).toBe(at + 5 * 60_000);
    // A countdown to a time counts by the clock, started or not (Session 50, section 7's review): it reaches zero then.
    expect(zeroAt({ ...toTime, startedAt: null }, at)).toBe(at + 5 * 60_000);
    expect(countsDown(toTime)).toBe(true);
    expect(countsDown({ kind: 'clock' })).toBe(false);
  });
});
