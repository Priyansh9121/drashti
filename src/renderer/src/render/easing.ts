/*
 * The audience screens' easings (Session 27), the design lab's own (design-lab/motion/effects.js): CSS-style
 * cubic Béziers solved here, so a frame is a pure function of how far its motion is. Smoothstep is
 * symmetrical, so a dissolve's in and out add up to 1 at every point and plus-lighter never dips.
 */

/** A CSS cubic-bezier(x1, y1, x2, y2), solved numerically (Newton's method, then halving if it must). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number): number => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-7) break;
      u -= e / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 60; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) return u;
      if (x > v) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)));
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const EASE = {
  linear: (p: number) => p,
  /** Smoothstep: symmetrical, so in(p) + out(p) = 1 at every p. Calm's dissolve. */
  smooth: (p: number) => p * p * (3 - 2 * p),
  /** Bold's dissolve, push and zoom-dissolve. */
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  /** Things settling into place: a line or word rising, a lower third, a message. */
  out: cubicBezier(0.23, 1, 0.32, 1),
  /** The hard diagonal wipe. */
  wipe: cubicBezier(0.77, 0, 0.175, 1),
} as const;

/** How far through [start, start + length] `t` is, clamped to 0..1, then eased. */
export const seg = (
  t: number,
  start: number,
  length: number,
  ease: (p: number) => number = EASE.linear,
): number => ease(clamp01(length > 0 ? (t - start) / length : 1));

export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
