import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameSpacing, watchFrameGrid } from './frame-grid';

describe("the stream page's frame grid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads its frames spacing from their middle gap, a missed frame or two not counting', () => {
    expect(frameSpacing([0, 33.3, 66.7, 100, 133.3, 200, 233.3])).toBeCloseTo(33.3, 1);
    expect(frameSpacing([0, 33.3, 66.7])).toBeNull();
  });

  it('tells Main when its frames begin, on the engine clock, once a second, and stops', () => {
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
    expect(told.length).toBe(3);
    expect(told[0]?.periodMs).toBeCloseTo(1000 / 30, 3);
    // The frame's own begin, not its callback's time.
    expect(((told[0]?.at ?? 0) - (1_000_000 + 5000)) % (1000 / 30)).toBeCloseTo(0, 3);
    stop();
    expect(cancelled).toBe(1);
  });
});
