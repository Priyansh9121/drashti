import { describe, expect, it } from 'vitest';
import { stageStill } from './stage-deck';

/* What a stage screen keeps under a deck's slide coming in (Session 54, C review): the still that showed before. */

describe('a stage screen’s deck box (C review)', () => {
  it('keeps the still that showed before a new slide came under it, and nothing under the first one it shows', () => {
    const first = stageStill(null, 'a@1', 'a-last2');
    expect(first.before).toBeNull();
    // The same slide at another step: what was under its first step stays.
    const clicked = stageStill(first, 'a@1', 'a-last3');
    expect(clicked).toEqual({ key: 'a@1', still: 'a-last3', before: null });
    // A new slide: the still the box showed last, under its coming-in clip.
    expect(stageStill(clicked, 'b@2', 'b-last0')).toEqual({
      key: 'b@2',
      still: 'b-last0',
      before: 'a-last3',
    });
    expect(stageStill(clicked, 'a@1', 'a-last3')).toBe(clicked);
  });
});
