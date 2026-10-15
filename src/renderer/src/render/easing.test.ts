import { describe, expect, it } from 'vitest';
import { cubicBezier, EASE, lerp, seg } from './easing';

/* The audience screens' easings, the design lab's (Session 27). */

describe('the easings', () => {
  it('start at 0, end at 1, and never go back', () => {
    for (const [name, ease] of Object.entries(EASE)) {
      expect(ease(0), name).toBe(0);
      expect(ease(1), name).toBe(1);
      for (let i = 1; i <= 100; i++)
        expect(ease(i / 100), name).toBeGreaterThanOrEqual(ease((i - 1) / 100) - 1e-9);
    }
  });

  it('smoothstep and Bold’s ease in and out are symmetrical: half-way is half-way, and in + out = 1', () => {
    for (const ease of [EASE.smooth, EASE.inOut]) {
      expect(ease(0.5)).toBeCloseTo(0.5, 6);
      for (let i = 0; i <= 100; i++) expect(ease(i / 100) + ease(1 - i / 100)).toBeCloseTo(1, 6);
    }
  });

  it('solves a CSS cubic Bézier: the straight one is straight, and an ease-out is ahead of it', () => {
    const straight = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const p of [0.1, 0.33, 0.8]) expect(straight(p)).toBeCloseTo(p, 6);
    expect(EASE.out(0.25)).toBeGreaterThan(0.5);
    expect(cubicBezier(0.65, 0, 0.35, 1)(-1)).toBe(0);
    expect(cubicBezier(0.65, 0, 0.35, 1)(2)).toBe(1);
  });

  it('seg: how far through a part of a motion, clamped, then eased; lerp between two values', () => {
    expect(seg(100, 200, 100)).toBe(0);
    expect(seg(250, 200, 100)).toBe(0.5);
    expect(seg(400, 200, 100)).toBe(1);
    expect(seg(250, 200, 100, EASE.smooth)).toBe(0.5);
    expect(seg(5, 0, 0)).toBe(1);
    expect(lerp(1.03, 1, 0.5)).toBeCloseTo(1.015, 9);
  });
});
