import { describe, expect, it } from 'vitest';
import { bootstrapDifference, compare, percentile, seeded, verdict } from '../../../scripts/perf-compare.mjs';
import type { RawChange } from '../../../scripts/perf-compare.mjs';

/*
 * The Performance check's comparer (Sessions 31–36, PERF-2): the head's segments against the base's, with
 * 95% bootstrap intervals from a fixed seed. The same changes say no change; changes 5 ms slower in the
 * main process say slower there and nowhere else. Made-up figures only.
 */

/** Changes whose segments vary a little around the given lengths (ms). */
function changes(n: number, keyToMain: number, mainToFrame: number, seed: number): RawChange[] {
  const random = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const keyAt = 1_000_000 + i * 40;
    const mainAt = keyAt + keyToMain + random() * 2;
    const paintedAt = mainAt + mainToFrame + random() * 16;
    return { rev: i, keyAt, mainAt, paintedAt, nextAt: paintedAt + 16 + random() };
  });
}

describe('the Performance comparer', () => {
  it('says no change for the same changes, and the same each time', () => {
    const runs = changes(200, 2, 9, 1);
    const once = compare(runs, runs);
    expect(once).toEqual(compare(runs, runs));
    for (const line of once) expect(line).toMatch(/: no change$/u);
  });

  it('says slower where the head is 5 ms slower, and no change elsewhere', () => {
    const lines = compare(changes(200, 2, 9, 1), changes(200, 7, 9, 2));
    expect(lines.find((l) => l.startsWith('key to main, median'))).toMatch(/: slower$/u);
    expect(lines.find((l) => l.startsWith('frame to the next, median'))).toMatch(/: no change$/u);
  });

  it('gives an interval for the difference that holds the true one', () => {
    const base = Array.from({ length: 300 }, (_, i) => 10 + (i % 7));
    const head = base.map((v) => v + 3);
    const d = bootstrapDifference(base, head, (v) => percentile(v, 0.5));
    expect(d.diff).toBe(3);
    expect(d.low).toBeLessThanOrEqual(3);
    expect(d.high).toBeGreaterThanOrEqual(3);
    expect(verdict(d)).toBe('slower');
    expect(verdict(bootstrapDifference([], head, (v) => percentile(v, 0.5)))).toBe('too few to tell');
  });
});
