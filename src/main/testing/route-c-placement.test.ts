import { describe, expect, it } from 'vitest';
import {
  latencyFromGraph,
  loudRuns,
  METER_STEP_MS,
  placeByGraph,
} from '../../../tests/e2e/route-c-placement';

/*
 * caption-ai-real.spec.ts through the stream-clock seam (alpha.23, cap-realc; lead 2, QA23-REALC-3 held for the owner):
 * each clip placed where it actually played in the stream's own audio graph (the stream page's level reports, the
 * loudest of each 100 ms), not where the file holds it on the wall clock. On CI's Mac the graph played slower than real
 * time (run 45401342094: a 2.56 s voice loud for 4.0 s, arriving 2.2 s late), so the file's positions put whole, right
 * sentences on the wrong clips. A clip's latency runs from the end of its sound in the graph to its words on a screen,
 * with the meter's 100 ms step ADDED (the sound may have ended up to a step before its last loud report), never
 * subtracted: never less than the truth.
 */

/** Level reports every 100 ms from `from` to `to` (ms), loud (-20 dBFS) inside the given spans, else silence. */
function reports(from: number, to: number, loud: [number, number][]): { at: number; db: number }[] {
  const out: { at: number; db: number }[] = [];
  for (let at = from; at <= to; at += 100)
    out.push({ at, db: loud.some(([a, b]) => at >= a && at <= b) ? -20 : -100 });
  return out;
}

describe('placing each clip where it played in the stream’s graph', () => {
  it('a clip on time: its loud reports, its end a meter step before its last loud report', () => {
    // Modelled on run 45401342094's hi-01-f (on time): 4.1 s of voice from 15.0 s.
    const levels = reports(0, 30_000, [[15_000, 19_100]]);
    expect(loudRuns(levels)).toEqual([{ first: 15_000, last: 19_100 }]);
    expect(placeByGraph(levels, 1)).toEqual([{ startAt: 15_000, endAt: 19_100 - METER_STEP_MS }]);
  });

  it('a clip that plays slow: placed where it played, however late and long', () => {
    // Modelled on gu-02-m there: due at 24.4 s for 2.56 s, it played from 26.6 s and stayed loud 4.0 s.
    const levels = reports(0, 40_000, [
      [15_000, 18_800],
      [26_600, 30_600],
    ]);
    expect(placeByGraph(levels, 2)).toEqual([
      { startAt: 15_000, endAt: 18_700 },
      { startAt: 26_600, endAt: 30_500 },
    ]);
  });

  it('pauses between words keep one clip whole; a second of silence or more ends it', () => {
    const levels = reports(0, 20_000, [
      [5_000, 5_800],
      [6_200, 7_000],
      [9_000, 9_500],
    ]);
    expect(loudRuns(levels)).toEqual([
      { first: 5_000, last: 7_000 },
      { first: 9_000, last: 9_500 },
    ]);
  });

  it('no placement when the graph did not play as many clips as the file holds', () => {
    const levels = reports(0, 20_000, [[5_000, 7_000]]);
    expect(placeByGraph(levels, 2)).toBeNull();
    expect(placeByGraph(reports(0, 20_000, []), 1)).toBeNull();
  });

  it('latency: from the end of the sound in the graph, the 100 ms meter step added, never subtracted', () => {
    expect(METER_STEP_MS).toBe(100);
    const [clip] = placeByGraph(reports(0, 30_000, [[15_000, 17_500]]), 1) ?? [];
    if (!clip) throw new Error('not placed');
    // Words drawn 1.0 s after the last loud report: 1.1 s.
    expect(latencyFromGraph(18_500, clip)).toBe(1_100);
    // Never less than from the last loud report itself.
    expect(latencyFromGraph(18_500, clip)).toBeGreaterThan(18_500 - 17_500);
  });
});
