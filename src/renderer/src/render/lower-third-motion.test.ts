import { describe, expect, it } from 'vitest';
import type { LowerThirdLine } from '../../../shared/program';
import {
  type LowerThirdRun,
  lowerThirdAt,
  lowerThirdFrame,
  lowerThirdLength,
  nextLowerThirdRun,
} from './lower-third-motion';

/* How a lower third moves (Session 27, the design lab's timings), and when (Session 51). */

describe('a lower third’s motion', () => {
  it('takes the lab’s times: Calm in 250 ms, a change 400, out 180; Bold out 310, its lines one after another', () => {
    expect(lowerThirdLength('in', 'calm', 2)).toBe(250);
    expect(lowerThirdLength('change', 'calm', 2)).toBe(400);
    expect(lowerThirdLength('out', 'calm', 2)).toBe(180);
    expect(lowerThirdLength('in', 'bold', 2)).toBe(120 + 60 + 360);
    expect(lowerThirdLength('change', 'bold', 2)).toBe(120 + 60 + 300);
    expect(lowerThirdLength('out', 'bold', 2)).toBe(310);
  });

  it('Calm comes in and goes out as a whole, fading in place; its words cross while the box holds', () => {
    expect(lowerThirdFrame('in', 'calm', 0).whole).toBe(0);
    expect(lowerThirdFrame('in', 'calm', 250).whole).toBe(1);
    const change = lowerThirdFrame('change', 'calm', 200);
    expect(change.whole).toBe(1);
    expect(change.side).toBeNull();
    expect(change.oldWords + change.newLine(0).opacity).toBeCloseTo(1, 9);
    expect(lowerThirdFrame('out', 'calm', 0).whole).toBe(1);
    expect(lowerThirdFrame('out', 'calm', 180).whole).toBe(0);
  });

  it('Bold opens its box from the middle, its lines rising in; the box holds as the words change; it closes going out', () => {
    expect(lowerThirdFrame('in', 'bold', 0)).toMatchObject({ whole: 1, side: 50 });
    expect(lowerThirdFrame('in', 'bold', 0).newLine(0)).toEqual({ opacity: 0, rise: 16 });
    expect(lowerThirdFrame('in', 'bold', 1000)).toMatchObject({ side: null });
    expect(lowerThirdFrame('in', 'bold', 1000).newLine(1)).toEqual({ opacity: 1, rise: 0 });
    const change = lowerThirdFrame('change', 'bold', 100);
    expect(change).toMatchObject({ whole: 1, side: null });
    expect(change.oldLine(0).opacity).toBeLessThan(1);
    expect(change.newLine(0).opacity).toBe(0);
    expect(lowerThirdFrame('out', 'bold', 0)).toMatchObject({ side: 0, oldWords: 1 });
    expect(lowerThirdFrame('out', 'bold', 310)).toMatchObject({ side: 50, oldWords: 0 });
  });
});

/** Placeholder lines. */
const lines = (...words: string[]): LowerThirdLine[] =>
  words.map((text) => ({ lang: null, runs: [{ text }], boxFont: null }));
const ONE = lines('Placeholder one', 'Placeholder two');
const TWO = lines('Placeholder three');
const gone: LowerThirdRun = { key: null, lines: [], prev: null, phase: 'gone', start: 0 };

describe('what a lower third draws at a moment (Session 51: a key and its fill alike, whatever frames each gets)', () => {
  const coming: LowerThirdRun = { key: 'a@1000', lines: ONE, prev: null, phase: 'in', start: 1000 };

  it('its motion is over by the engine’s time alone: in and a change are still from their length on, out is gone', () => {
    // CI's failure (Session 50's gate): held 400 ms after Calm's 250 ms in, the key still drew it coming in.
    expect(lowerThirdAt(coming, 'calm', 1000 + 249)).toBe(coming);
    expect(lowerThirdAt(coming, 'calm', 1000 + 400)).toEqual({ ...coming, phase: 'still' });
    // Bold's in is longer, one line after another.
    expect(lowerThirdAt(coming, 'bold', 1000 + 400)).toBe(coming);
    expect(lowerThirdAt(coming, 'bold', 1000 + lowerThirdLength('in', 'bold', 2)).phase).toBe('still');
    const changing: LowerThirdRun = { key: 'b@2000', lines: TWO, prev: ONE, phase: 'change', start: 2000 };
    expect(lowerThirdAt(changing, 'calm', 2000 + 399)).toBe(changing);
    expect(lowerThirdAt(changing, 'calm', 2000 + 400)).toEqual({ ...changing, prev: null, phase: 'still' });
    // CI's other failure: held 250 ms after Calm's 180 ms out, the key still drew it going, at no opacity.
    const going: LowerThirdRun = { key: null, lines: [], prev: TWO, phase: 'out', start: 3000 };
    expect(lowerThirdAt(going, 'calm', 3000 + 179)).toBe(going);
    expect(lowerThirdAt(going, 'calm', 3000 + 250)).toEqual({ ...gone, start: 3000 });
    expect(lowerThirdAt(going, 'bold', 3000 + 250)).toBe(going);
    expect(lowerThirdAt(going, 'bold', 3000 + 310).phase).toBe('gone');
  });

  it('is the same however many moments a screen drew before (one that drew none, one that drew every one)', () => {
    const runs: LowerThirdRun[] = [
      coming,
      { key: 'b@2000', lines: TWO, prev: ONE, phase: 'change', start: 2000 },
      { key: null, lines: [], prev: TWO, phase: 'out', start: 3000 },
    ];
    for (const run of runs)
      for (const movement of ['calm', 'bold'] as const)
        for (let early = run.start - 100; early <= run.start + 700; early += 20)
          for (let late = early; late <= run.start + 700; late += 20) {
            const drewEarly = lowerThirdAt(lowerThirdAt(run, movement, early), movement, late);
            expect(drewEarly, `${run.phase} ${movement} ${String(early)} then ${String(late)}`).toEqual(
              lowerThirdAt(run, movement, late),
            );
          }
  });

  it('a clock held before it began draws its motion (pure in the time); still and gone stay as they are', () => {
    expect(lowerThirdAt(coming, 'calm', 1000 - 60_000)).toBe(coming);
    const still: LowerThirdRun = { ...coming, phase: 'still' };
    expect(lowerThirdAt(still, 'calm', 0)).toBe(still);
    expect(lowerThirdAt(gone, 'bold', 1e12)).toBe(gone);
  });
});

describe('what a lower third begins when what is up changes (Session 51: from what it draws then)', () => {
  it('comes in, changes as its box holds, goes out when its slide is taken off on its own, and goes at once on Clear all', () => {
    const coming = nextLowerThirdRun(gone, 'a@1000', ONE, 1000, null, 'calm', 1010);
    expect(coming).toEqual({ key: 'a@1000', lines: ONE, prev: null, phase: 'in', start: 1000 });
    // The next slide while it is still coming in, or once still (its run says in; the time says still): a change.
    for (const now of [1100, 5000])
      expect(nextLowerThirdRun(coming, `b@${String(now)}`, TWO, now, null, 'calm', now)).toEqual({
        key: `b@${String(now)}`,
        lines: TWO,
        prev: ONE,
        phase: 'change',
        start: now,
      });
    // Taken off on its own: out from then, the words up going.
    const off = { at: 6000 };
    expect(nextLowerThirdRun(coming, null, [], 0, off, 'calm', 6005)).toEqual({
      key: null,
      lines: [],
      prev: ONE,
      phase: 'out',
      start: 6000,
    });
    // Clear all (no slideOff): gone at once.
    expect(nextLowerThirdRun(coming, null, [], 0, null, 'calm', 6005)).toEqual(gone);
  });

  it('after its out is over by the time (whatever its run says), the next slide comes in, not a change', () => {
    const going: LowerThirdRun = { key: null, lines: [], prev: ONE, phase: 'out', start: 6000 };
    expect(nextLowerThirdRun(going, 'c@6100', TWO, 6100, null, 'calm', 6100).phase).toBe('in');
    expect(nextLowerThirdRun(going, 'c@9000', TWO, 9000, null, 'calm', 9000)).toEqual({
      key: 'c@9000',
      lines: TWO,
      prev: null,
      phase: 'in',
      start: 9000,
    });
  });

  it('a change a screen hears of late keeps its motion and is drawn as the time has it (still once over)', () => {
    const late = nextLowerThirdRun(gone, 'a@1000', ONE, 1000, null, 'calm', 4000);
    expect(late.phase).toBe('in');
    expect(lowerThirdAt(late, 'calm', 4000).phase).toBe('still');
    // A slide off long ago: nothing goes out.
    const still: LowerThirdRun = { key: 'a@1000', lines: ONE, prev: null, phase: 'still', start: 1000 };
    expect(
      lowerThirdAt(nextLowerThirdRun(still, null, [], 0, { at: 1500 }, 'calm', 4000), 'calm', 4000).phase,
    ).toBe('gone');
  });
});
