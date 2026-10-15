import { describe, expect, it } from 'vitest';
import { lowerThirdFrame, lowerThirdLength } from './lower-third-motion';

/* How a lower third moves (Session 27, the design lab's timings). */

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
