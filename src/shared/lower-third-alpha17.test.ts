import { describe, expect, it } from 'vitest';
import { LOWER_THIRD_MOTIONS, NEAREST_ALPHA17_MOTION } from './lower-third-styles';
import { ALPHA17_MOTIONS } from './testing/alpha17-lower-third';

describe('lower third backgrounds for alpha.17', () => {
  it('maps every new background and only new backgrounds', () => {
    const known = new Set<string>(ALPHA17_MOTIONS);
    const added = LOWER_THIRD_MOTIONS.filter((motion) => !known.has(motion));
    expect(Object.keys(NEAREST_ALPHA17_MOTION).sort()).toEqual(added.sort());
  });

  it('maps to moving backgrounds that alpha.17 knows', () => {
    const moving = ALPHA17_MOTIONS.filter((motion) => motion !== 'none');
    for (const [motion, fallback] of Object.entries(NEAREST_ALPHA17_MOTION)) {
      expect(moving, motion).toContain(fallback);
    }
  });
});
