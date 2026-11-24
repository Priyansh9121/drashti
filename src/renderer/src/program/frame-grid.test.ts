import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitGrid, frameSpacing, watchFrameGrid } from './frame-grid';

describe("the stream page's frame grid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads its frames spacing from their middle gap, a missed frame or two not counting', () => {
    expect(frameSpacing([0, 33.3, 66.7, 100, 133.3, 200, 233.3])).toBeCloseTo(33.3, 1);
    expect(frameSpacing([0, 33.3, 66.7])).toBeNull();
  });

  it('fits its frames over two seconds, so a Go placed 40 frames on still falls on one (a22-cue)', () => {
    // CI's off-screen frames come 33.3-34.2 ms apart on average (a21-s5-1123-152334-44457), from a timer whose single
    // gaps are whole milliseconds: the middle gap (34 here) put a Go 10-28 ms off a frame planned 20 ms after it.
    const begins: number[] = [];
    let t = 5000;
    for (let i = 0; i < 60; i++) {
      begins.push(t);
      t += i % 2 === 0 ? 33 : 34;
    }
    const grid = fitGrid(begins);
    expect(grid).not.toBeNull();
    expect(grid?.periodMs ?? 0).toBeCloseTo(33.5, 1);
    // The 40th frame after the last one told: within a millisecond of where it comes.
    const last = begins.at(-1) ?? 0;
    const fortieth = last + 20 * 67;
    expect(Math.abs((grid?.at ?? 0) + 40 * (grid?.periodMs ?? 0) - fortieth)).toBeLessThan(1);
  });

  it('fits through a missed frame, and has no grid from too few frames', () => {
    const begins = [0, 33.4, 66.8, 133.6, 167, 200.4, 233.8, 267.2, 300.6].map((b) => b + 1000);
    expect(fitGrid(begins)?.periodMs ?? 0).toBeCloseTo(33.4, 2);
    expect(fitGrid(begins)?.at ?? 0).toBeCloseTo(1300.6, 1);
    expect(fitGrid([0, 33.3, 66.7])).toBeNull();
  });

  it('tells Main when its frames begin, on the engine clock, four times a second, and stops', () => {
    const callbacks: FrameRequestCallback[] = [];
    let cancelled = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => cancelled++);
    let clock = 5000;
    vi.stubGlobal('performance', { now: () => clock });
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + clock);
    const told: { at: number; periodMs: number }[] = [];
    const stop = watchFrameGrid((grid) => told.push(grid));
    for (let i = 0; i < 70; i++) {
      const began = 5000 + i * (1000 / 30);
      clock = began + 4; // its callback runs 4 ms after the frame began
      callbacks.shift()?.(began);
    }
    // 70 frames over 2.3 s, its first grid once 8 had begun: told every quarter of a second from then on.
    expect(told.length).toBe(8);
    expect(told[0]?.periodMs).toBeCloseTo(1000 / 30, 3);
    // The frame's own begin, not its callback's time.
    const phase = ((((told[0]?.at ?? 0) - (1_000_000 + 5000)) % (1000 / 30)) + 1000 / 30) % (1000 / 30);
    expect(Math.min(phase, 1000 / 30 - phase)).toBeCloseTo(0, 3);
    stop();
    expect(cancelled).toBe(1);
  });
});
