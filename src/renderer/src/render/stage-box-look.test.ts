import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { StageBox } from '../../../shared/stage-layouts';
import type { TimerState } from '../../../shared/timers';
import { boxFillStyle, boxWordsStyle, FIT_LARGEST, fitAgain, fitLargest } from './stage-box-look';

/* A stage layout box's own look as it draws (Session 54): left out, a box saved before draws as it did. */

const box: StageBox = {
  id: 'placeholder-box',
  kind: 'timer',
  frame: { x: 48, y: 48, width: 760, height: 220 },
  size: 'fit',
  color: '#ffffff',
  align: 'left',
  label: '',
  timerId: 'placeholder-countdown',
};

const countdown: TimerState = {
  id: 'placeholder-countdown',
  name: 'Placeholder countdown',
  kind: 'countdown',
  durationMs: 10 * 60_000,
  targetTime: null,
  allowsOverrun: false,
  startedAt: 0,
  elapsedMs: 0,
};

describe('a stage box’s look', () => {
  it('is nothing of its own when it has no settings, as a box saved before', () => {
    expect(boxFillStyle(box)).toEqual({});
    expect(boxWordsStyle(box)).toEqual({});
    expect(fitLargest(box)).toBe(400);
  });

  it('fills the box behind its words, as see-through as set, rounded and with room round them', () => {
    expect(boxFillStyle({ fill: { color: '#102030', seeThrough: 0.25 } })).toEqual({
      background: 'rgba(16, 32, 48, 0.75)',
      borderRadius: 16,
      padding: '12px 24px',
      boxSizing: 'border-box',
    });
    expect(boxFillStyle({ fill: { color: '#000000', seeThrough: 1 } }).background).toBe('rgba(0, 0, 0, 0)');
    // A colour with its own see-through: both.
    expect(boxFillStyle({ fill: { color: '#00000080', seeThrough: 0.5 } }).background).toBe(
      'rgba(0, 0, 0, 0.251)',
    );
  });

  it('draws its words bold, with a line round the letters and Drashti’s soft shadow, as set', () => {
    expect(boxWordsStyle({ bold: true })).toEqual({ fontWeight: 700 });
    expect(boxWordsStyle({ outline: { color: '#101010', width: 3 } })).toEqual({
      WebkitTextStroke: '6px #101010',
      paintOrder: 'stroke fill',
    });
    expect(boxWordsStyle({ shadow: true })).toEqual({ textShadow: '0 0.06em 0.18em rgba(0, 0, 0, 0.85)' });
    expect(boxWordsStyle({ bold: false, shadow: false })).toEqual({});
  });

  it('lets its words grow as large as the box holds when it says so', () => {
    expect(fitLargest({ fitWhole: true })).toBe(FIT_LARGEST);
    expect(FIT_LARGEST).toBeGreaterThanOrEqual(1080);
  });
});

describe('when a fitting box measures its words again', () => {
  const state = { ...initialEngineState(), timers: [countdown] };
  const again = (b: StageBox, now: number) => fitAgain(b, state, now, null);

  it('is when its time takes another shape, never at each second', () => {
    // 10:00, then 9:59 and 9:58: four figures, then three.
    expect(again(box, 0)).not.toBe(again(box, 1000)); // 10:00 to 9:59
    expect(again(box, 1000)).toBe(again(box, 2000)); // 9:59 to 9:58
    // Always with the hours: 0:10:00, then 0:09:59, the same shape.
    expect(again({ ...box, format: 'hmmss' }, 0)).toBe(again({ ...box, format: 'hmmss' }, 1000));
  });

  it('is when its look or its size changes', () => {
    const base = again(box, 1);
    expect(again({ ...box, bold: true }, 1)).not.toBe(base);
    expect(again({ ...box, fill: { color: '#000000', seeThrough: 0.5 } }, 1)).not.toBe(base);
    expect(again({ ...box, frame: { ...box.frame, width: 700 } }, 1)).not.toBe(base);
    expect(again({ ...box, fitWhole: true }, 1)).not.toBe(base);
    expect(again({ ...box, color: '#fde68a' }, 1)).toBe(base);
  });

  it('is for a clock box when its time takes another shape', () => {
    const clock: StageBox = { ...box, kind: 'clock', hours: 24, seconds: true };
    const at = new Date(2026, 9, 27, 9, 59, 58).getTime();
    expect(again(clock, at)).toBe(again(clock, at + 1000));
  });
});
