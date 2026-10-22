import { describe, expect, it } from 'vitest';
import type { TimerElement } from '../../../shared/model';
import type { TimerState } from '../../../shared/timers';
import { digitCells, digitFrame, digitLength, DIGIT_ROLL, drawnTime, lastMinuteColor } from './timer-digits';

/*
 * A Timer on a slide as the screens draw it (Session 50): only the digits that change move, from the moment
 * they changed by the engine's clock (so every screen draws the same frame): in a Calm Look each fades to
 * the next, in a Bold Look it rolls up. A countdown's last minute in its own colour, when the element says so.
 */

const countdown: TimerState = {
  id: 't1',
  name: 'Placeholder countdown',
  kind: 'countdown',
  durationMs: 10 * 60_000,
  targetTime: null,
  allowsOverrun: false,
  startedAt: 0,
  elapsedMs: 0,
};

describe('the digits of a timer on a slide', () => {
  it('are cells kept from the right, each changed one with the digit it was', () => {
    expect(digitCells('4:59', '5:00')).toEqual([
      { key: 3, char: '4', was: '5' },
      { key: 2, char: ':', was: null },
      { key: 1, char: '5', was: '0' },
      { key: 0, char: '9', was: '0' },
    ]);
    // The minutes grow shorter: the seconds keep their cells, the ten goes.
    expect(digitCells('9:59', '10:00')).toEqual([
      { key: 4, char: '', was: '1' },
      { key: 3, char: '9', was: '0' },
      { key: 2, char: ':', was: null },
      { key: 1, char: '5', was: '0' },
      { key: 0, char: '9', was: '0' },
    ]);
    expect(digitCells('0:07', null).map((c) => c.was)).toEqual([null, null, null, null]);
  });

  it('move only just after they changed, from that moment, the same on every screen', () => {
    // 1.1 s gone: 9:59 since 1 s, its last two digits changing (the minute too: 10:00 to 9:59).
    const at = drawnTime(countdown, 1_100, null, 'calm');
    expect(at.text).toBe('9:59');
    expect(at.changing).toBe(1_000);
    expect(at.cells.filter((c) => c.was !== null).map((c) => c.key)).toEqual([4, 3, 1, 0]);
    // Later in that second: still.
    expect(drawnTime(countdown, 1_400, null, 'calm')).toMatchObject({ text: '9:59', changing: null });
    expect(drawnTime(countdown, 1_400, null, 'calm').cells.every((c) => c.was === null)).toBe(true);
    // A Bold Look's roll takes a little longer.
    expect(drawnTime(countdown, 1_350, null, 'bold').changing).toBe(1_000);
    // 2.05 s: only the last digit.
    expect(drawnTime(countdown, 2_050, null, 'calm').cells.filter((c) => c.was !== null)).toEqual([
      { key: 0, char: '8', was: '9' },
    ]);
    // Paused, or a timer no longer there: nothing moves.
    expect(
      drawnTime({ ...countdown, startedAt: null, elapsedMs: 1_000 }, 1_100, null, 'calm').changing,
    ).toBeNull();
    expect(drawnTime(undefined, 1_100, null, 'calm')).toMatchObject({ text: '--:--', changing: null });
  });

  it('fade in a Calm Look and roll up in a Bold one, and are at rest when done', () => {
    expect(digitLength('calm')).toBe(300);
    expect(digitLength('bold')).toBe(400);
    expect(digitFrame('calm', 0)).toEqual({ in: { opacity: 0, rise: 0 }, out: { opacity: 1, rise: 0 } });
    expect(digitFrame('calm', 150)).toEqual({
      in: { opacity: 0.5, rise: 0 },
      out: { opacity: 0.5, rise: 0 },
    });
    expect(digitFrame('calm', 300)).toEqual({ in: { opacity: 1, rise: 0 }, out: { opacity: 0, rise: 0 } });
    expect(digitFrame('bold', 0)).toEqual({
      in: { opacity: 0, rise: DIGIT_ROLL },
      out: { opacity: 1, rise: 0 },
    });
    const half = digitFrame('bold', 200);
    expect(half.in.opacity).toBeCloseTo(0.5, 5);
    expect(half.in.rise).toBeCloseTo(DIGIT_ROLL / 2, 5);
    expect(half.out.rise).toBeCloseTo(-DIGIT_ROLL / 2, 5);
    expect(digitFrame('bold', 400)).toEqual({
      in: { opacity: 1, rise: 0 },
      out: { opacity: 0, rise: -DIGIT_ROLL },
    });
  });

  it('turn the element’s colour in a countdown’s last minute, when it says so', () => {
    const el = { lastMinute: { color: '#f5a524' } } as Pick<TimerElement, 'lastMinute'>;
    const near = { ...countdown, durationMs: 90_000 };
    expect(lastMinuteColor(el, near, 29_999)).toBeNull();
    expect(lastMinuteColor(el, near, 30_000)).toBe('#f5a524');
    expect(lastMinuteColor({}, near, 30_000)).toBeNull();
    expect(lastMinuteColor({ lastMinute: null }, near, 30_000)).toBeNull();
    expect(lastMinuteColor(el, undefined, 30_000)).toBeNull();
    expect(lastMinuteColor(el, { ...near, kind: 'countup' }, 30_000)).toBeNull();
  });
});
