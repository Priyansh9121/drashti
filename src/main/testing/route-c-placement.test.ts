import { describe, expect, it } from 'vitest';
import {
  firstSoundAt,
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
  it('a clip on time: its loud reports, its end a meter step before the report before its last loud one', () => {
    // Modelled on run 45401342094's hi-01-f (on time): 4.1 s of voice from 15.0 s.
    const levels = reports(0, 30_000, [[15_000, 19_100]]);
    expect(loudRuns(levels)).toEqual([{ first: 15_000, last: 19_100 }]);
    expect(placeByGraph(levels, 1)).toEqual([{ startAt: 15_000, endAt: 19_000 - METER_STEP_MS }]);
  });

  it('a clip that plays slow: placed where it played, however late and long', () => {
    // Modelled on gu-02-m there: due at 24.4 s for 2.56 s, it played from 26.6 s and stayed loud 4.0 s.
    const levels = reports(0, 40_000, [
      [15_000, 18_800],
      [26_600, 30_600],
    ]);
    expect(placeByGraph(levels, 2)).toEqual([
      { startAt: 15_000, endAt: 18_600 },
      { startAt: 26_600, endAt: 30_400 },
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
    // Words drawn 1.0 s after the last loud report: 1.2 s (counted from the start of that report's step, review MUST-1).
    expect(latencyFromGraph(18_500, clip)).toBe(1_200);
    // Never less than from the last loud report itself.
    expect(latencyFromGraph(18_500, clip)).toBeGreaterThan(18_500 - 17_500);
  });

  it('the end never falls after the sound really ended, on the stream page’s own meter (review MUST-1)', () => {
    // capture.ts's meter: a look every 25 ms (40 when timers fire late), each seeing the last 2048 samples at 48 kHz
    // (43 ms of the graph's time; 2.2 times that on the wall clock when the graph plays 2.2x slow, as on CI's Mac), and a
    // report every 4 looks with the loudest: one report reaches back about 118 ms, more than its 100 ms step.
    for (const slow of [1, 2.2])
      for (const lookMs of [25, 40])
        for (let phase = 0; phase < 100; phase += 2) {
          const levels = modelledMeter({ from: 15_000, to: 17_500, lookMs, slow, phase, until: 25_000 });
          const [clip] = placeByGraph(levels, 1) ?? [];
          expect(
            clip,
            `slow ${String(slow)}, looks ${String(lookMs)} ms, phase ${String(phase)}`,
          ).toBeDefined();
          expect(
            clip?.endAt ?? Infinity,
            `slow ${String(slow)}, looks ${String(lookMs)} ms, phase ${String(phase)}`,
          ).toBeLessThanOrEqual(17_500);
        }
    // A sound that ends 110 ms before its last loud report.
    const levels = modelledMeter({ from: 15_000, to: 17_465, lookMs: 25, slow: 1, phase: 0, until: 20_000 });
    expect(loudRuns(levels).at(-1)?.last).toBe(17_575);
    expect(placeByGraph(levels, 1)?.[0]?.endAt).toBeLessThanOrEqual(17_465);
  });

  it('nothing may be heard before the first clip: from the later of its file time and where the graph played it (MUST-2)', () => {
    expect(firstSoundAt(16_300, 15_400)).toBe(16_300);
    expect(firstSoundAt(15_000, 15_400)).toBe(15_400);
    expect(firstSoundAt(undefined, 15_400)).toBe(15_400);
  });
});

/**
 * The stream page's meter as capture.ts runs it: a look every `lookMs`, each seeing the graph's last 43 ms (`slow`
 * times that on the wall clock), and every 4 looks a report with the loudest. Loud when a look's window overlaps the
 * sound [from, to].
 */
function modelledMeter(o: {
  from: number;
  to: number;
  lookMs: number;
  slow: number;
  phase: number;
  until: number;
}): { at: number; db: number }[] {
  const reach = 43 * o.slow;
  const out: { at: number; db: number }[] = [];
  let loud = false;
  let looks = 0;
  for (let t = o.phase; t <= o.until; t += o.lookMs) {
    if (t > o.from && t - reach < o.to) loud = true;
    if (++looks === 4) {
      out.push({ at: t, db: loud ? -20 : -100 });
      loud = false;
      looks = 0;
    }
  }
  return out;
}
