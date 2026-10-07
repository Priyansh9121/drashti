import { describe, expect, it } from 'vitest';
import { overlapCheck, paceOf } from './perftest';

describe("the performance check's import overlap (Session 17)", () => {
  it('reads the pace the slides really kept, never quicker than asked', () => {
    // Every 2 s as asked, each change taking a little to answer.
    expect(paceOf([0, 2012, 4020, 6035, 8047], 2000)).toBe(2012);
    // The plain check's 40 ms, with one change missing (a double gap) and one late.
    expect(paceOf([0, 52, 104, 208, 259, 330], 40)).toBe(52);
    // Too few changes to tell: as asked.
    expect(paceOf([0], 2000)).toBe(2000);
    expect(paceOf([0, 30], 40)).toBe(40);
  });

  it('does not fail a quick computer whose import is over before two changes could come', () => {
    // CI's Mac: 400 files in about a second, one change at the import's start (run 37594049559).
    const quick = overlapCheck(1, 1100, 2, 2012);
    expect(quick.ok).toBe(true);
    expect(quick.name).toBe('the import overlapped at least 2 slide changes (if it lasted 4.0 s or more)');
    expect(quick.detail).toBe('1 in 1.1 s, quicker than 2 changes take: nothing to judge');
  });

  it('still fails an import long enough for two changes that overlapped fewer: the slides stopped', () => {
    const stalled = overlapCheck(1, 12_300, 2, 2012);
    expect(stalled.ok).toBe(false);
    expect(stalled.detail).toBe('1 in 12.3 s');
    // Long enough by a whisker, and the second change came.
    expect(overlapCheck(2, 4100, 2, 2012).ok).toBe(true);
    expect(overlapCheck(1, 4100, 2, 2012).ok).toBe(false);
    // Windows CI's slower import, slides kept going (6 in that run).
    expect(overlapCheck(6, 12_300, 2, 2012)).toMatchObject({ ok: true, detail: '6 in 12.3 s' });
  });

  it("measures the plain check's 10 changes against its real pace, not the 40 ms asked", () => {
    // A 0.45 s import at a 52 ms pace: the 10th change would start at 0.47 s, so none is owed.
    expect(overlapCheck(9, 450, 10, 52).ok).toBe(true);
    expect(overlapCheck(9, 450, 10, 52).name).toBe(
      'the import overlapped at least 10 slide changes (if it lasted 0.5 s or more)',
    );
    // A second's import at that pace owes 10 at least (it would get about 20).
    expect(overlapCheck(19, 1000, 10, 52).ok).toBe(true);
    expect(overlapCheck(4, 1000, 10, 52).ok).toBe(false);
  });
});
