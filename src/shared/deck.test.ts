import { describe, expect, it } from 'vitest';
import { stepCount, type DeckSlide } from './deck';

const step = (n: number) => ({ clipId: `clip-${n}`, clipMs: 1000, lastId: `last-${n}` });

describe('a deck’s slide shown as it was (Session 54, C2)', () => {
  it('has one step when it is no deck’s, and its deck’s steps otherwise', () => {
    expect(stepCount(undefined)).toBe(1);
    const deck: DeckSlide = { steps: [step(0), step(1), step(2)], media: [] };
    expect(stepCount(deck)).toBe(3);
  });

  it('never has fewer than one step, even a deck slide saved with none', () => {
    expect(stepCount({ steps: [], media: [] })).toBe(1);
  });
});
