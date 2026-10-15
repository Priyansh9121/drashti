/*
 * The design lab's flash check (design-lab/motion/tools/flash-check.cjs, Session 24), as Drashti's own tests
 * use it on the audience screens' real frames (Session 27). A frame's light is the mean relative luminance
 * (WCAG 2.x, sRGB made linear) over the frame and over each quarter, and the share of saturated red. A
 * series of frames swings when its light moves at least `threshold` one way and then back; a swing counts
 * as a flash's half when its darker end is below `dark`. Nothing on a screen may swing more than three times
 * in any second (WCAG 2.3.1), red included.
 */

/** sRGB (0 to 255) made linear, as WCAG 2.x defines it. */
export const LINEAR: readonly number[] = Array.from({ length: 256 }, (_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

/** A colour's relative luminance, 0 to 1. */
export const luminance = (r: number, g: number, b: number): number =>
  0.2126 * (LINEAR[r] ?? 0) + 0.7152 * (LINEAR[g] ?? 0) + 0.0722 * (LINEAR[b] ?? 0);

/** Whether a pixel is saturated red, as the lab counts it: bright enough, and at least 80% red. */
export const saturatedRed = (r: number, g: number, b: number): boolean =>
  r + g + b > 30 && r / (r + g + b) >= 0.8;

/** One frame's light: the mean over the frame, over each quarter (top left, top right, bottom left, bottom right), and the share of saturated red. */
export interface FrameLight {
  mean: number;
  quad: [number, number, number, number];
  red: number;
}

/**
 * A frame's light from its RGBA pixels, every `step`th pixel each way (every second, as the lab measures
 * it: the frame's other pixels are like their neighbours; 1 for pixels already taken that way).
 */
export function frameLight(rgba: ArrayLike<number>, width: number, height: number, step = 2): FrameLight {
  let sum = 0;
  let n = 0;
  let red = 0;
  const q = [0, 0, 0, 0];
  const qn = [0, 0, 0, 0];
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4;
      const r = rgba[o] ?? 0;
      const g = rgba[o + 1] ?? 0;
      const b = rgba[o + 2] ?? 0;
      const l = luminance(r, g, b);
      sum += l;
      n++;
      const k = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      q[k] = (q[k] ?? 0) + l;
      qn[k] = (qn[k] ?? 0) + 1;
      if (saturatedRed(r, g, b)) red++;
    }
  const at = (k: number) => (q[k] ?? 0) / Math.max(1, qn[k] ?? 0);
  return { mean: sum / Math.max(1, n), quad: [at(0), at(1), at(2), at(3)], red: red / Math.max(1, n) };
}

export interface Swings {
  /** The swings that count (their darker end below `dark`). */
  legs: number;
  /** The most of them that end within any one second. */
  worst: number;
}

/**
 * Swings in a series of light sampled `perSecond` times a second, the lab's way: legs between turning
 * points at least `threshold` apart, each counting when its darker end is below `dark`; the most that end
 * in any one second.
 */
export function swings(series: readonly number[], perSecond: number, threshold = 0.1, dark = 0.8): Swings {
  const first = series[0] ?? 0;
  const legs: { from: number; to: number; i: number }[] = [];
  let dir = 0;
  let start = first;
  let ext = first;
  let extI = 0;
  let lo = first;
  let hi = first;
  for (let i = 1; i < series.length; i++) {
    const v = series[i] ?? 0;
    if (dir === 0) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (v - lo >= threshold) {
        dir = 1;
        start = lo;
        ext = v;
        extI = i;
      } else if (hi - v >= threshold) {
        dir = -1;
        start = hi;
        ext = v;
        extI = i;
      }
      continue;
    }
    if (dir === 1 ? v > ext : v < ext) {
      ext = v;
      extI = i;
    } else if (dir === 1 ? ext - v >= threshold : v - ext >= threshold) {
      legs.push({ from: start, to: ext, i: extI });
      dir = -dir;
      start = ext;
      ext = v;
      extI = i;
    }
  }
  if (dir !== 0 && Math.abs(ext - start) >= threshold) legs.push({ from: start, to: ext, i: extI });
  const counted = legs.filter((l) => Math.min(l.from, l.to) < dark);
  let worst = 0;
  for (let s = 0; s < series.length; s++)
    worst = Math.max(worst, counted.filter((l) => l.i >= s && l.i < s + perSecond).length);
  return { legs: counted.length, worst };
}

/** Whether a series ever falls below its darker end, or rises above its brighter end, by more than `by`. */
export function dipsAndOvershoots(
  series: readonly number[],
  by = 0.01,
): { dips: boolean; overshoots: boolean } {
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;
  return {
    dips: Math.min(...series) < Math.min(first, last) - by,
    overshoots: Math.max(...series) > Math.max(first, last) + by,
  };
}
