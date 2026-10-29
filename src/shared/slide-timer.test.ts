import { describe, expect, it } from 'vitest';
import type { TimerElement } from './model';
import {
  slideTimerColor,
  slideTimerDimmed,
  slideTimerShows,
  slideTimerText,
  slideTimerWarn,
} from './slide-timer';
import type { TimerState } from './timers';

/*
 * A timer on a slide as Edit slides sets it since Session 55 (Part 15): its warning from a time left (an older slide's
 * last minute reads as its warning from a minute left), its colour at zero, its flash at zero, what it shows at zero,
 * and its format.
 */

const T0 = 2_000_000;
const countdown: TimerState = {
  id: 't',
  name: 'Placeholder',
  kind: 'countdown',
  durationMs: 120_000,
  targetTime: null,
  allowsOverrun: false,
  startedAt: T0,
  elapsedMs: 0,
};

const el = (
  extra: Partial<TimerElement> = {},
): Pick<TimerElement, 'warn' | 'lastMinute' | 'overColor' | 'atZero' | 'flash' | 'format'> => ({ ...extra });

describe('a timer on a slide', () => {
  it('turns its warning colour from its time left, an older slide’s last minute as a minute’s warning', () => {
    expect(slideTimerWarn(el({ lastMinute: { color: '#f5a524' } }))).toEqual({
      fromMs: 60_000,
      color: '#f5a524',
    });
    expect(
      slideTimerWarn(el({ warn: { fromMs: 10_000, color: '#ff0000' }, lastMinute: { color: '#f5a524' } })),
    ).toEqual({
      fromMs: 10_000,
      color: '#ff0000',
    });
    const warned = el({ warn: { fromMs: 30_000, color: '#ff0000' } });
    expect(slideTimerColor(warned, countdown, T0 + 89_000)).toBeNull();
    expect(slideTimerColor(warned, countdown, T0 + 90_000)).toBe('#ff0000');
    // Its colour at zero and past it, when it has one.
    expect(slideTimerColor({ ...warned, overColor: '#00ff00' }, countdown, T0 + 120_000)).toBe('#00ff00');
    expect(slideTimerColor({ ...warned, overColor: '#00ff00' }, countdown, T0 + 119_000)).toBe('#ff0000');
    expect(slideTimerColor(warned, { ...countdown, kind: 'countup' }, T0 + 119_000)).toBeNull();
    expect(slideTimerColor(warned, undefined, T0)).toBeNull();
  });

  it('at zero: holds (and the next slide comes on, the engine’s), shows its message, or goes', () => {
    for (const atZero of ['hold', 'next', 'message', 'gone'] as const) {
      expect(slideTimerShows(el({ atZero }), countdown, T0 + 1000)).toBe('time');
      expect(slideTimerShows(el({ atZero }), countdown, T0 + 120_000)).toBe(
        atZero === 'message' || atZero === 'gone' ? atZero : 'time',
      );
    }
    expect(slideTimerShows(el({ atZero: 'message' }), { ...countdown, kind: 'countup' }, T0 + 999_999)).toBe(
      'time',
    );
  });

  it('flashes for ten seconds at zero only when asked, and writes its time in its format', () => {
    expect(slideTimerDimmed(el(), countdown, T0 + 120_000)).toBe(false);
    const dims = [0, 1, 2, 3].map((s) =>
      slideTimerDimmed(el({ flash: true }), countdown, T0 + 120_000 + s * 1000 + 500),
    );
    expect(dims.filter(Boolean)).toHaveLength(2);
    const long = { ...countdown, durationMs: 65 * 60_000 };
    expect(slideTimerText(el(), long, T0, null)).toBe('1:05:00');
    expect(slideTimerText(el({ format: 'mss' }), long, T0, null)).toBe('65:00');
    expect(slideTimerText(el({ format: 'hmmss' }), countdown, T0, null)).toBe('0:02:00');
  });
});
