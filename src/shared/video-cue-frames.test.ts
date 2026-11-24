import { describe, expect, it } from 'vitest';
import { goOnStreamFrame, STREAM_FRAME_MARGIN_MS } from './video-cue';

const PERIOD = 1000 / 30;
/** Where `at` falls on the grid: 0 when it is on one of its frames. */
const phase = (at: number, grid: { at: number; periodMs: number }) =>
  (((at - grid.at) % grid.periodMs) + grid.periodMs) % grid.periodMs;

describe("a Go on the stream's frames", () => {
  it('is placed the margin before the first stream frame that leaves at least the margin after the earliest Go', () => {
    const grid = { at: 1_000_007.5, periodMs: PERIOD };
    for (const earliest of [1_000_100, 1_000_113.3, 1_000_120, 1_000_133.4, 1_005_000.9]) {
      const go = goOnStreamFrame(earliest, grid);
      expect(go).toBeGreaterThanOrEqual(earliest);
      expect(go - earliest).toBeLessThan(PERIOD);
      const toFrame = phase(go + STREAM_FRAME_MARGIN_MS, grid);
      expect(Math.min(toFrame, PERIOD - toFrame)).toBeLessThan(1e-6);
    }
  });

  it('follows a grid reported long before, as its frames keep their spacing', () => {
    const grid = { at: 0.25, periodMs: PERIOD };
    const go = goOnStreamFrame(1_795_403_307_477, grid);
    const toFrame = phase(go + STREAM_FRAME_MARGIN_MS, grid);
    expect(Math.min(toFrame, PERIOD - toFrame)).toBeLessThan(1e-3);
    expect(go - 1_795_403_307_477).toBeLessThan(PERIOD);
  });

  it('is the earliest Go itself with no stream, or a grid that makes no sense', () => {
    expect(goOnStreamFrame(5000, null)).toBe(5000);
    for (const periodMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1000])
      expect(goOnStreamFrame(5000, { at: 4990, periodMs })).toBe(5000);
    expect(goOnStreamFrame(5000, { at: Number.NaN, periodMs: PERIOD })).toBe(5000);
  });
});
