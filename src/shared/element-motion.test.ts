import { describe, expect, it } from 'vitest';
import { elementMotionSchema } from './model-schema';
import { motionFrame } from './element-motion';

describe('element motion on the shared engine timeline', () => {
  it('has no motion or wake-up for an older element', () => {
    expect(motionFrame(undefined, 500)).toMatchObject({
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      rotate: 0,
      moving: false,
      nextAt: null,
    });
  });
  it('waits hidden for its entrance, fades in, and reaches its exact final frame', () => {
    const motion = elementMotionSchema.parse({ in: { kind: 'fade', delayMs: 1000, durationMs: 1000 } });
    expect(motionFrame(motion, 0)).toMatchObject({ opacity: 0, moving: false, nextAt: 1000 });
    expect(motionFrame(motion, 1000).opacity).toBe(0);
    expect(motionFrame(motion, 1500).opacity).toBeCloseTo(0.5, 10);
    expect(motionFrame(motion, 2000)).toMatchObject({ opacity: 1, moving: false, nextAt: null });
    expect(motionFrame(motion, 20_000)).toEqual(motionFrame(motion, 2000));
  });
  it('finishes a rise and a zoom exactly in place, without moving the stored frame', () => {
    for (const kind of ['rise', 'zoom'] as const) {
      const motion = elementMotionSchema.parse({ in: { kind, delayMs: 0, durationMs: 500 } });
      expect(motionFrame(motion, 0).opacity).toBe(0);
      expect(motionFrame(motion, 500)).toMatchObject({ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 });
    }
  });
  it('emphasis returns to the same place and scale rather than accumulating per frame', () => {
    const pulse = elementMotionSchema.parse({ emphasis: { kind: 'pulse', delayMs: 1000, durationMs: 1000 } });
    expect(motionFrame(pulse, 1000).scale).toBe(1);
    expect(motionFrame(pulse, 1500).scale).toBeGreaterThan(1.05);
    expect(motionFrame(pulse, 2000).scale).toBe(1);
    const turn = elementMotionSchema.parse({ emphasis: { kind: 'turn', delayMs: 0, durationMs: 1000 } });
    expect(Math.abs(motionFrame(turn, 250).rotate)).toBeGreaterThan(3);
    expect(motionFrame(turn, 1000).rotate).toBe(0);
  });
  it('holds before its out, then disappears on every late join', () => {
    const motion = elementMotionSchema.parse({ out: { kind: 'fade', delayMs: 3000, durationMs: 1000 } });
    expect(motionFrame(motion, 2000)).toMatchObject({ opacity: 1, moving: false, nextAt: 3000 });
    expect(motionFrame(motion, 3500).opacity).toBeCloseTo(0.5, 10);
    expect(motionFrame(motion, 4000)).toMatchObject({ opacity: 0, moving: false, nextAt: null });
    expect(motionFrame(motion, 50_000).opacity).toBe(0);
  });
  it('composes overlapping phases deterministically, with no dependence on frames already painted', () => {
    const motion = elementMotionSchema.parse({
      in: { kind: 'fade', delayMs: 0, durationMs: 2000 },
      out: { kind: 'fade', delayMs: 0, durationMs: 2000 },
    });
    expect(motionFrame(motion, 1000).opacity).toBeCloseTo(0.25, 10);
    const afterReload = elementMotionSchema.parse(JSON.parse(JSON.stringify(motion)));
    expect(motionFrame(afterReload, 1000)).toEqual(motionFrame(motion, 1000));
  });
  it('rejects invalid durations, non-finite values, delays and effects in the wrong phase', () => {
    for (const step of [
      { kind: 'fade', delayMs: -1, durationMs: 500 },
      { kind: 'fade', delayMs: 0, durationMs: 0 },
      { kind: 'fade', delayMs: Infinity, durationMs: 500 },
      { kind: 'fade', delayMs: 0, durationMs: NaN },
      { kind: 'pulse', delayMs: 0, durationMs: 500 },
    ])
      expect(elementMotionSchema.safeParse({ in: step }).success).toBe(false);
  });
});
