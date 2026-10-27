import { describe, expect, it } from 'vitest';
import { barFraction, barSpan, keyPress, keyTarget, leftText, timeAt, timeWords } from './time-bar';

/* The time bar's arithmetic (Session 54): the bar is the whole file, and every move keeps between its points. */

describe('the time bar', () => {
  // A 90 s file that plays between 0:10 and 1:20.
  const span = barSpan(90_000, 10_000, 80_000);

  it('keeps its points inside the file, the end never before the start; no end point is the file’s end', () => {
    expect(barSpan(90_000)).toEqual({ durationMs: 90_000, startMs: 0, endMs: 90_000 });
    expect(barSpan(90_000, 10_000, null)).toEqual({ durationMs: 90_000, startMs: 10_000, endMs: 90_000 });
    expect(barSpan(90_000, -5, 120_000)).toEqual({ durationMs: 90_000, startMs: 0, endMs: 90_000 });
    expect(barSpan(90_000, 50_000, 20_000)).toEqual({ durationMs: 90_000, startMs: 50_000, endMs: 50_000 });
  });

  it('draws a time along the whole file', () => {
    expect(barFraction(45_000, 90_000)).toBe(0.5);
    expect(barFraction(-1, 90_000)).toBe(0);
    expect(barFraction(99_000, 90_000)).toBe(1);
    expect(barFraction(1000, 0)).toBe(0);
  });

  it('moves to the time under the finger, in whole ms, never past its start or end point', () => {
    expect(timeAt(0.5, span)).toBe(45_000);
    expect(timeAt(1 / 3, span)).toBe(30_000);
    // Before the start point: the start point; past the end point: the end point; off the bar: its ends.
    expect(timeAt(0.05, span)).toBe(10_000);
    expect(timeAt(0.95, span)).toBe(80_000);
    expect(timeAt(-2, span)).toBe(10_000);
    expect(timeAt(7, span)).toBe(80_000);
  });

  it('takes the arrows 5 s, Page Up and Page Down 30 s, Home and End to its points; leaves every other key alone', () => {
    expect(keyTarget('ArrowRight', 30_000, span)).toBe(35_000);
    expect(keyTarget('ArrowUp', 30_000, span)).toBe(35_000);
    expect(keyTarget('ArrowLeft', 30_000, span)).toBe(25_000);
    expect(keyTarget('ArrowDown', 12_000, span)).toBe(10_000);
    expect(keyTarget('PageUp', 60_000, span)).toBe(80_000);
    expect(keyTarget('PageDown', 60_000, span)).toBe(30_000);
    expect(keyTarget('Home', 60_000, span)).toBe(10_000);
    expect(keyTarget('End', 60_000, span)).toBe(80_000);
    for (const key of ['Space', 'Enter', 'a', 'Escape']) expect(keyTarget(key, 60_000, span)).toBeNull();
  });

  it('takes its keys, each press one move; a key held down moves nothing more, and a key with Cmd, Ctrl or Alt is left alone (Session 54’s review)', () => {
    const press = (key: string, more: Partial<Parameters<typeof keyPress>[0]> = {}) =>
      keyPress({ key, repeat: false, altKey: false, ctrlKey: false, metaKey: false, ...more }, 30_000, span);
    expect(press('ArrowRight')).toEqual({ to: 35_000 });
    expect(press('End')).toEqual({ to: 80_000 });
    // Held down: each repeat is the bar's (the show's keys never hear it) but moves nothing.
    expect(press('ArrowRight', { repeat: true })).toEqual({ to: null });
    expect(press('PageUp', { repeat: true })).toEqual({ to: null });
    // Already there: taken, no move.
    expect(
      keyPress({ key: 'Home', repeat: false, altKey: false, ctrlKey: false, metaKey: false }, 10_000, span),
    ).toEqual({ to: null });
    // Not the bar's: left to the window (the show's keys, the menus).
    expect(press('Space')).toBeNull();
    expect(press('ArrowRight', { metaKey: true })).toBeNull();
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
    expect(press('ArrowLeft', { ctrlKey: true })).toBeNull();
  });

  it('writes the time left to the end point as a countdown does, and says its time in whole seconds', () => {
    expect(leftText(30_000, span)).toBe('-0:50');
    expect(leftText(29_400, span)).toBe('-0:51');
    expect(leftText(80_000, span)).toBe('-0:00');
    expect(timeWords(12_300, barSpan(75_000))).toBe('0:12 of 1:15, 1:03 left');
  });
});
