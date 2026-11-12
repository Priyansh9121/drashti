import { describe, expect, it } from 'vitest';
import { caseLine, caseRow, framePeriod, measureRun, type MotionRecord } from './motion-measure';

/*
 * Item 6 (Session 57: animations on the spot): the arithmetic the Performance check's animations scenario judges each
 * case by, from the motion probe's record of an audience screen's frames (render/motion-probe.ts).
 */

const PERIOD = 1000 / 60;

/** A screen drawing `count` frames at 60 a second from `from` (ms since the epoch), with `gaps` added after frames. */
function frames(from: number, count: number, gaps: Record<number, number> = {}): number[] {
  const out: number[] = [];
  let at = from;
  for (let i = 0; i < count; i++) {
    out.push(at);
    at += PERIOD + (gaps[i] ?? 0);
  }
  return out;
}

/** Frame indexes from `first` to `last`, each one a change. */
const span = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

describe('a screen’s frame period', () => {
  it('is the median gap between its frames, leaving out the long waits of a screen with nothing to draw', () => {
    const at = frames(0, 61);
    // A second with nothing drawn, and a stall, after the 30th frame: neither is the display's rate.
    const withWaits = [...at.slice(0, 30), ...at.slice(30).map((t) => t + 1000)];
    expect(framePeriod(at)).toBeCloseTo(PERIOD, 6);
    expect(framePeriod(withWaits)).toBeCloseTo(PERIOD, 6);
  });

  it('is a 60 Hz frame when there is nothing to tell', () => {
    expect(framePeriod([])).toBeCloseTo(PERIOD, 6);
    expect(framePeriod([5])).toBeCloseTo(PERIOD, 6);
  });
});

describe('one run of a case', () => {
  const record: MotionRecord = { frames: frames(1000, 120), changes: span(2, 50) };

  it('is late by the time from the press to the first frame that moved', () => {
    const run = measureRun(record, { pressAt: 1010, until: 3000 }, PERIOD);
    // Frame 2 began 33.3 ms after the first: 23.3 ms after the press.
    expect(run.delay).toBeCloseTo(1000 + 2 * PERIOD - 1010, 6);
    expect(run.firstAt).toBeCloseTo(1000 + 2 * PERIOD, 6);
    expect(run.lastAt).toBeCloseTo(1000 + 50 * PERIOD, 6);
  });

  it('lasts from its first moving frame to its last, counting the first one’s frame: a perfect run measures its length', () => {
    const run = measureRun(record, { pressAt: 1010, until: 3000 }, PERIOD);
    // 49 frames moved: 48 intervals, and the first frame's own.
    expect(run.length).toBeCloseTo(49 * PERIOD, 6);
    expect(run.moved).toBe(49);
  });

  it('keeps every interval between the frames drawn while it moved, a late frame among them', () => {
    const late: MotionRecord = { frames: frames(1000, 120, { 20: 33.3 }), changes: span(2, 50) };
    const run = measureRun(late, { pressAt: 1010, until: 4000 }, PERIOD);
    expect(run.intervals).toHaveLength(48);
    expect(Math.max(...run.intervals)).toBeCloseTo(PERIOD + 33.3, 6);
    expect(run.intervals.filter((i) => i > PERIOD * 1.5)).toHaveLength(1);
    // The late frame lengthens it by as much.
    expect(run.length).toBeCloseTo(49 * PERIOD + 33.3, 6);
  });

  it('is a cut when a single frame changed: no length, no intervals', () => {
    const cut = measureRun({ frames: frames(1000, 60), changes: [3] }, { pressAt: 1020, until: 2000 }, PERIOD);
    expect(cut.delay).toBeCloseTo(1000 + 3 * PERIOD - 1020, 6);
    expect(cut.length).toBe(0);
    expect(cut.moved).toBe(1);
    expect(cut.intervals).toEqual([]);
  });

  it('says nothing moved when no frame changed in its time', () => {
    const none = measureRun({ frames: frames(1000, 60), changes: [] }, { pressAt: 1020, until: 2000 }, PERIOD);
    expect(none).toEqual({ delay: null, length: null, moved: 0, intervals: [], firstAt: null, lastAt: null });
  });

  it('counts only its own frames: from a frame before the press until the next case’s', () => {
    // A change long before the press (the case before), one in the frame that began just before it, and the next
    // case's from `until`.
    const mixed: MotionRecord = { frames: frames(1000, 120), changes: [1, 9, 10, 11, 12, 80, 81] };
    const pressAt = 1000 + 9 * PERIOD + 4;
    const run = measureRun(mixed, { pressAt, until: 1000 + 80 * PERIOD }, PERIOD);
    expect(run.firstAt).toBeCloseTo(1000 + 9 * PERIOD, 6);
    expect(run.delay).toBeCloseTo(-4, 6);
    expect(run.lastAt).toBeCloseTo(1000 + 12 * PERIOD, 6);
    expect(run.moved).toBe(4);
  });
});

describe('a case’s row, from its runs', () => {
  const run = (delay: number, frameCount: number, gap = 0) => {
    const at = frames(0, 200, gap > 0 ? { 10: gap } : {});
    const first = Math.round(delay / PERIOD) + 1;
    return measureRun(
      { frames: at, changes: span(first, first + frameCount - 1) },
      { pressAt: (at[first] ?? 0) - delay, until: 5000 },
      PERIOD,
    );
  };

  it('gives the delay’s median and p95, the length’s median and how far it is off, and the frames drawn', () => {
    const runs = [20, 25, 30, 40, 22, 24].map((d) => run(d, 48));
    const row = caseRow('dissolve 800', 800, runs, PERIOD);
    expect(row.runs).toBe(6);
    expect(row.seen).toBe(6);
    expect(row.delay?.median).toBeCloseTo(24, 6);
    expect(row.delay?.p95).toBeCloseTo(30, 6);
    expect(row.length?.median).toBeCloseTo(48 * PERIOD, 6);
    expect(row.length?.off).toBeCloseTo(48 * PERIOD - 800, 6);
    expect(row.intervals?.count).toBe(6 * 47);
    expect(row.intervals?.median).toBeCloseTo(PERIOD, 6);
    expect(row.intervals?.max).toBeCloseTo(PERIOD, 6);
    expect(row.intervals?.over).toBe(0);
    expect(row.late).toBe(false);
    expect(row.uneven).toBe(false);
  });

  it('is late when its median delay is over a frame period and 16 ms', () => {
    const row = caseRow('push 800', 800, [60, 55, 70].map((d) => run(d, 48)), PERIOD);
    expect(row.late).toBe(true);
    expect(caseRow('push 800', 800, [30, 31, 32].map((d) => run(d, 48)), PERIOD).late).toBe(false);
  });

  it('is uneven when one interval is over twice the period, or the p95 is over one and a half', () => {
    const stall = caseRow('slide 800', 800, [run(20, 48, 25), run(20, 48)], PERIOD);
    expect(stall.intervals?.max).toBeCloseTo(PERIOD + 25, 6);
    expect(stall.intervals?.over).toBe(1);
    expect(stall.uneven).toBe(true);
    // A frame a little late (1.6 periods) once: over 1.5, never over 2, and the p95 is still one period.
    const once = caseRow('slide 800', 800, [run(20, 48, 10)], PERIOD);
    expect(once.intervals?.over).toBe(1);
    expect(once.uneven).toBe(false);
  });

  it('says so when a case never moved', () => {
    const row = caseRow('words 800', 800, [measureRun({ frames: frames(0, 10), changes: [] }, { pressAt: 0, until: 500 }, PERIOD)], PERIOD);
    expect(row.seen).toBe(0);
    expect(row.delay).toBeNull();
    expect(row.length).toBeNull();
    expect(row.intervals).toBeNull();
    expect(caseLine(row)).toContain('never seen moving');
  });

  it('reads as one line: the delay, the length against its set length, the frames and those over 1.5×', () => {
    const line = caseLine(caseRow('dissolve 800', 800, [20, 25, 30].map((d) => run(d, 48)), PERIOD));
    expect(line).toBe(
      'dissolve 800 (800 ms, 3 runs): delay median 25 ms, p95 25 ms; length 800 ms (+0); frames median 16.7, p95 16.7, longest 16.7 ms, 0 of 141 over 1.5×',
    );
  });
});
