import { describe, expect, it } from 'vitest';
import { frameKey } from '../ui/time-bar';
import { frameMsOf } from './frame-length';

/* The time bar's frame steps (alpha.20): a frame's length from a frame rate, and Alt with the arrows. */

describe('one frame back or on', () => {
  it('takes a frame’s length from its rate, within 1/120 s to 1/10 s', () => {
    expect(frameMsOf(25)).toBe(40);
    expect(frameMsOf(60)).toBeCloseTo(16.667, 3);
    expect(frameMsOf(120)).toBeCloseTo(8.333, 3);
    expect(frameMsOf(10)).toBe(100);
    for (const none of [null, undefined, 0, -25, Number.NaN, 240, 5]) expect(frameMsOf(none)).toBeNull();
  });

  it('steps with Alt and ← or → alone: never with Ctrl, Cmd or Shift, never without Alt', () => {
    const press = (
      key: string,
      more: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {},
    ) =>
      frameKey({
        key,
        repeat: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...more,
      });
    expect(press('ArrowRight')).toBe(1);
    expect(press('ArrowLeft')).toBe(-1);
    expect(press('ArrowUp')).toBeNull();
    expect(press('.')).toBeNull();
    expect(press('ArrowRight', { altKey: false })).toBeNull();
    expect(press('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(press('ArrowRight', { metaKey: true })).toBeNull();
    expect(press('ArrowRight', { shiftKey: true })).toBeNull();
  });
});
