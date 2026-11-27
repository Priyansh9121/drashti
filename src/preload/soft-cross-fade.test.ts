import { describe, expect, it } from 'vitest';
import { softCrossFades } from './cross-fade';

const READY = { looksOtherwise: true, motion: 'calm', chip: 'yes', quiet: true, reduced: false, canFade: true };

describe('safe stationary appearance fades', () => {
  it('cross-fades in Calm as well as Lively', () => {
    expect(softCrossFades(READY)).toBe(true);
    expect(softCrossFades({ ...READY, motion: 'lively' })).toBe(true);
  });
  it('never fades with Off, reduced motion, no known chip, a busy show, an unchanged look or no API', () => {
    for (const motion of ['calm', 'lively']) {
      const now = { ...READY, motion };
      expect(softCrossFades({ ...now, motion: 'off' })).toBe(false);
      expect(softCrossFades({ ...now, reduced: true })).toBe(false);
      expect(softCrossFades({ ...now, chip: 'no' })).toBe(false);
      expect(softCrossFades({ ...now, chip: 'unknown' })).toBe(false);
      expect(softCrossFades({ ...now, quiet: false })).toBe(false);
      expect(softCrossFades({ ...now, looksOtherwise: false })).toBe(false);
      expect(softCrossFades({ ...now, canFade: false })).toBe(false);
    }
  });
});
