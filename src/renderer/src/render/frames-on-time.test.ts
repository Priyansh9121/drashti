import { describe, expect, it } from 'vitest';
import { drawBeforeFrames, framesOnTime, ON_TIME_MS, STEADY_FRAMES } from './frames-on-time';

/** A page's frames given by hand: each request waits until the test gives the next frame's time. */
function frames() {
  const waiting: ((t: number) => void)[] = [];
  let requests = 0;
  return {
    frame: (tick: (t: number) => void) => {
      waiting.push(tick);
      requests += 1;
      return requests;
    },
    /** The next frame, at `t` ms; then whatever it set going has run. */
    async at(t: number) {
      waiting.shift()?.(t);
      await Promise.resolve();
      await Promise.resolve();
    },
    waiting: () => waiting.length,
  };
}

/** Frames until they come on time, watched: whether it has resolved yet, and how many frames it asked for. */
function watch(maxMs: number, live = () => true) {
  const page = frames();
  const seen: number[] = [];
  const kept: number[] = [];
  let done = false;
  void framesOnTime({
    maxMs,
    each: (n) => seen.push(n),
    live,
    keep: (request) => kept.push(request),
    frame: page.frame,
  }).then(() => {
    done = true;
  });
  return { page, seen, kept, done: () => done };
}

describe('frames on time (the warm-up and its last step, Session 58 fault 2)', () => {
  it('resolves once six frames in a row came on time, after a long wait such as the display compositor drawing a warm-up frame in software', async () => {
    const w = watch(3000);
    await w.page.at(0);
    // The display compositor still drawing an earlier frame (~0.8 s on CI's Windows).
    await w.page.at(800);
    expect(w.done()).toBe(false);
    for (let i = 1; i < STEADY_FRAMES; i++) {
      await w.page.at(800 + i * 33);
      expect(w.done(), `after ${String(i)} frames on time`).toBe(false);
    }
    await w.page.at(800 + STEADY_FRAMES * 33);
    expect(w.done()).toBe(true);
    expect(w.page.waiting(), 'no frame asked for once done').toBe(0);
    // Each frame given the waits measured before it (the warm-up moves its speck by it): none at the first two.
    expect(w.seen).toEqual([0, ...Array.from({ length: STEADY_FRAMES + 1 }, (_, n) => n)]);
    expect(w.kept.length, 'each request kept, to be cancelled').toBe(STEADY_FRAMES + 2);
  });

  it('starts counting again after a late frame', async () => {
    const w = watch(10_000);
    let t = 0;
    await w.page.at(t);
    for (let i = 0; i < STEADY_FRAMES - 1; i++) await w.page.at((t += 33));
    await w.page.at((t += ON_TIME_MS + 200));
    expect(w.done()).toBe(false);
    for (let i = 0; i < STEADY_FRAMES - 1; i++) await w.page.at((t += 33));
    expect(w.done()).toBe(false);
    await w.page.at(t + 33);
    expect(w.done()).toBe(true);
  });

  it('takes frames as on time within twice the middle wait, once there are ten, as a slow page drawing evenly', async () => {
    const w = watch(60_000);
    let t = 0;
    await w.page.at(t);
    // A page drawing evenly at 70 ms a frame, every frame late by the 50-ms rule, then on time by its own middle.
    for (let i = 0; i < 10 + STEADY_FRAMES - 1; i++) await w.page.at((t += 70));
    expect(w.done()).toBe(true);
  });

  it('stops waiting at its longest, by the frames’ own times, never on time', async () => {
    const w = watch(1000);
    await w.page.at(0);
    await w.page.at(600);
    expect(w.done()).toBe(false);
    await w.page.at(1200);
    expect(w.done()).toBe(true);
  });

  it('never resolves, nor asks for another frame, once its caller has gone', async () => {
    let live = true;
    const w = watch(3000, () => live);
    await w.page.at(0);
    live = false;
    for (let i = 1; i <= STEADY_FRAMES + 1; i++) await w.page.at(i * 16);
    expect(w.done()).toBe(false);
    expect(w.page.waiting()).toBe(0);
  });
});

describe('the warm-up’s frames before its transitions', () => {
  it('draws the two before frames, keeps their requests, then begins the transitions once', async () => {
    const page = frames();
    const kept: number[] = [];
    let drawn = 0;
    let ready = 0;
    drawBeforeFrames({
      count: 2,
      each: () => {
        drawn++;
      },
      live: () => true,
      keep: (request) => kept.push(request),
      ready: () => {
        ready++;
      },
      frame: page.frame,
    });
    await page.at(0);
    expect(drawn).toBe(1);
    expect(ready).toBe(0);
    await page.at(16);
    expect(drawn).toBe(2);
    expect(ready).toBe(1);
    expect(kept).toEqual([1, 2]);
    expect(page.waiting()).toBe(0);
  });

  it('a before frame already queued when the warm-up is cut cannot replace settling with during', async () => {
    const page = frames();
    const phases = ['before'];
    let finished = false;
    let drawn = 0;
    drawBeforeFrames({
      count: 2,
      each: () => {
        drawn++;
      },
      live: () => !finished,
      keep: () => undefined,
      ready: () => {
        phases.push('during');
      },
      frame: page.frame,
    });
    await page.at(0);
    // Main has said no GPU: finish marks it ended and starts settling. Cleanup/cancellation is still pending.
    finished = true;
    phases.push('settle');
    await page.at(16);
    expect(phases, 'the queued callback cannot restart a finished warm-up').toEqual(['before', 'settle']);
    expect(drawn, 'no further warm-up frame after the cut').toBe(1);
    expect(page.waiting()).toBe(0);
  });

  it('does nothing if cut after its first request but before that frame is delivered', async () => {
    const page = frames();
    let live = true;
    let drawn = 0;
    let ready = false;
    drawBeforeFrames({
      count: 2,
      each: () => {
        drawn++;
      },
      live: () => live,
      keep: () => undefined,
      ready: () => {
        ready = true;
      },
      frame: page.frame,
    });
    live = false;
    await page.at(0);
    expect(drawn).toBe(0);
    expect(ready).toBe(false);
    expect(page.waiting()).toBe(0);
  });
});
