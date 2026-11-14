import { describe, expect, it } from 'vitest';
import { LOWER_THIRD_MOTIONS, NEAREST_ALPHA17_MOTION } from './lower-third-styles';

// LOWER_THIRD_MOTIONS from src/shared/lower-third-styles.ts at v1.0.0-alpha.17.
const ALPHA17_MOTIONS: readonly string[] = ['none', 'sweep', 'shine', 'shapes', 'stripes', 'glow', 'line', 'sparkles'];

describe('lower third backgrounds for alpha.17', () => {
  it('maps every new background and only new backgrounds', () => {
    const added = LOWER_THIRD_MOTIONS.filter((motion) => !ALPHA17_MOTIONS.includes(motion));
    expect(Object.keys(NEAREST_ALPHA17_MOTION).sort()).toEqual(added.sort());
  });

  it('maps to moving backgrounds that alpha.17 knows', () => {
    const moving = ALPHA17_MOTIONS.filter((motion) => motion !== 'none');
    for (const [motion, fallback] of Object.entries(NEAREST_ALPHA17_MOTION)) {
      expect(moving, motion).toContain(fallback);
    }
  });
});
