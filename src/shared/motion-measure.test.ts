import { describe, expect, it } from 'vitest';
import {
  caseLine,
  caseRow,
  framePeriod,
  intervalStats,
  jumpFigures,
  jumpLine,
  type JumpOnScreens,
  measureRun,
  type MotionRecord,
  stillIntervals,
  stillLine,
} from './motion-measure';

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
    const cut = measureRun(
      { frames: frames(1000, 60), changes: [3] },
      { pressAt: 1020, until: 2000 },
      PERIOD,
    );
    expect(cut.delay).toBeCloseTo(1000 + 3 * PERIOD - 1020, 6);
    expect(cut.length).toBe(0);
    expect(cut.moved).toBe(1);
    expect(cut.intervals).toEqual([]);
  });

  it('says nothing moved when no frame changed in its time', () => {
    const none = measureRun(
      { frames: frames(1000, 60), changes: [] },
      { pressAt: 1020, until: 2000 },
      PERIOD,
    );
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

describe('one run of a case, never its neighbour’s frame (Session 58, C24)', () => {
  it('ends where the next case’s run begins, a frame before the next press: its first frame, begun just before that press, is the next case’s only', () => {
    // This case moves in frames 9-12; the next case is pressed 4 ms into frame 79, whose frame (begun before the press)
    // already shows it. Counted here too, this run would stretch over every still frame from 12 to 79, a late one
    // among them (after frame 40).
    const record: MotionRecord = {
      frames: frames(1000, 120, { 40: 20 }),
      changes: [9, 10, 11, 12, 79, 80, 81],
    };
    const nextPress = 1000 + 79 * PERIOD + 20 + 4;
    const run = measureRun(record, { pressAt: 1000 + 9 * PERIOD + 4, until: nextPress }, PERIOD);
    expect(run.lastAt).toBeCloseTo(1000 + 12 * PERIOD, 6);
    expect(run.moved).toBe(4);
    expect(run.intervals).toHaveLength(3);
    // The next case's own run has that frame (from a frame before its press).
    const after = measureRun(record, { pressAt: nextPress, until: 1000 + 200 * PERIOD }, PERIOD);
    expect(after.firstAt).toBeCloseTo(1000 + 79 * PERIOD + 20, 6);
    expect(after.moved).toBe(3);
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
    const row = caseRow(
      'push 800',
      800,
      [60, 55, 70].map((d) => run(d, 48)),
      PERIOD,
    );
    expect(row.late).toBe(true);
    expect(
      caseRow(
        'push 800',
        800,
        [30, 31, 32].map((d) => run(d, 48)),
        PERIOD,
      ).late,
    ).toBe(false);
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
    const row = caseRow(
      'words 800',
      800,
      [measureRun({ frames: frames(0, 10), changes: [] }, { pressAt: 0, until: 500 }, PERIOD)],
      PERIOD,
    );
    expect(row.seen).toBe(0);
    expect(row.delay).toBeNull();
    expect(row.length).toBeNull();
    expect(row.intervals).toBeNull();
    expect(caseLine(row)).toContain('never seen moving');
  });

  it('reads as one line: the delay, the length against its set length, the frames and those over 1.5×', () => {
    const line = caseLine(
      caseRow(
        'dissolve 800',
        800,
        [20, 25, 30].map((d) => run(d, 48)),
        PERIOD,
      ),
    );
    expect(line).toBe(
      'dissolve 800 (800 ms, 3 runs): delay median 25 ms, p95 25 ms; length 800 ms (+0); frames median 16.7, p95 16.7, longest 16.7 ms, 0 of 141 over 1.5×',
    );
  });
});

describe('a screen’s still frames, between the cases', () => {
  it('are the intervals between the frames it drew in a stretch where nothing moved, summed up as a case’s are', () => {
    const at = frames(0, 100, { 40: 20 });
    const still = stillIntervals(at, at[30] ?? 0, at[60] ?? 0);
    // Frames 30 to 59: 29 intervals, one of them 20 ms late.
    expect(still).toHaveLength(29);
    const stats = intervalStats(still, PERIOD);
    expect(stats?.count).toBe(29);
    expect(stats?.median).toBeCloseTo(PERIOD, 6);
    expect(stats?.max).toBeCloseTo(PERIOD + 20, 6);
    expect(stats?.over).toBe(1);
    expect(intervalStats([], PERIOD)).toBeNull();
    expect(stillIntervals(at, 5000, 6000)).toEqual([]);
  });

  it('read as one line, beside the cases', () => {
    const at = frames(0, 100, { 40: 20 });
    expect(stillLine(intervalStats(stillIntervals(at, at[30] ?? 0, at[60] ?? 0), PERIOD))).toBe(
      'still frames (nothing moving, between the cases): median 16.7, p95 16.7, longest 36.7 ms, 1 of 29 over 1.5×',
    );
    expect(stillLine(null)).toBe('still frames (nothing moving, between the cases): none');
  });
});

describe('a jump to a deck slide Drashti plays itself, on two hall screens (DK-6)', () => {
  /** One jump: the engine's own times (its first effect starts as the slide goes up), and each screen's frames. */
  const jump = (shownAt: number, arrived: (number | null)[], moved: (number | null)[]): JumpOnScreens => ({
    shownAt,
    effectAt: shownAt,
    arrivedAt: arrived,
    movedAt: moved,
  });
  const runs = [
    jump(1000, [1080, 1100], [1080, 1100]),
    jump(5000, [5050, 5040], [5060, 5040]),
    jump(9000, [9120, 9200], [9120, 9210]),
  ];

  it('says how long after the engine’s time each screen showed it and moved its first effect, and how far apart', () => {
    const f = jumpFigures(runs);
    expect(f.runs).toBe(3);
    expect(f.screens).toEqual([
      { seen: 3, arrival: { median: 80, max: 120 }, effect: { median: 80, max: 120 } },
      { seen: 3, arrival: { median: 100, max: 200 }, effect: { median: 100, max: 210 } },
    ]);
    // Each run's second screen against its first, whichever was first.
    expect(f.apart).toEqual({ arrival: { median: 20, max: 80 }, effect: { median: 20, max: 90 } });
  });

  it('counts an effect from its own start, and leaves out a screen’s run that never showed it', () => {
    const late = { ...jump(0, [300, null], [300, null]), effectAt: 200 };
    const f = jumpFigures([late, jump(1000, [1040, 1060], [1040, 1060])]);
    // Its first effect starts 200 ms after the slide went up: the frame 300 ms after is 100 ms into it.
    expect(f.screens[0]).toEqual({
      seen: 2,
      arrival: { median: 40, max: 300 },
      effect: { median: 40, max: 100 },
    });
    expect(f.screens[1]).toEqual({
      seen: 1,
      arrival: { median: 60, max: 60 },
      effect: { median: 60, max: 60 },
    });
    // Apart only where both screens showed it.
    expect(f.apart).toEqual({ arrival: { median: 20, max: 20 }, effect: { median: 20, max: 20 } });
  });

  it('has no screens apart with one screen, and nothing for a screen that never showed it', () => {
    const f = jumpFigures([jump(0, [30], [40]), jump(1000, [null], [null])]);
    expect(f.screens).toEqual([
      { seen: 1, arrival: { median: 30, max: 30 }, effect: { median: 40, max: 40 } },
    ]);
    expect(f.apart).toBeNull();
    expect(jumpFigures([jump(0, [null, null], [null, null])]).screens).toEqual([
      { seen: 0, arrival: null, effect: null },
      { seen: 0, arrival: null, effect: null },
    ]);
  });

  it('reads as one line: each screen against the engine’s time, then the screens apart', () => {
    expect(jumpLine(jumpFigures(runs))).toBe(
      'a jump to a deck slide Drashti plays itself (3 runs, 2 screens): screen 1 showed it +80 ms from the engine’s time (the most +120), moved its first effect +80 ms from its start (the most +120); screen 2 showed it +100 ms from the engine’s time (the most +200), moved its first effect +100 ms from its start (the most +210); screens apart: 20 ms showing it (the most 80), 20 ms moving it (the most 90)',
    );
    expect(jumpLine(jumpFigures([jump(0, [null], [null])]))).toBe(
      'a jump to a deck slide Drashti plays itself (1 run, 1 screen): screen 1 never showed it',
    );
  });
});
