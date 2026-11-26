import { describe, expect, it } from 'vitest';
import { crossFades } from './cross-fade';

/*
 * One appearance fading into the next, with its band sweeping in (Sessions 40 and 42): only in Lively, the show quiet,
 * the computer allowing motion; and (the release lead's review of uimotion, MUST-1, 27 Nov 2026) only with a graphics
 * chip, as all of Lively since alpha.24, so a new install's Lively default never fades the window on a chipless PC.
 */
const NOW = {
  looksOtherwise: true,
  motion: 'lively',
  chip: 'yes',
  quiet: true,
  reduced: false,
  canFade: true,
} as const;

describe('one appearance fading into the next', () => {
  it('fades in Lively with a graphics chip', () => {
    expect(crossFades(NOW)).toBe(true);
  });

  it('never without a known chip', () => {
    expect(crossFades({ ...NOW, chip: 'no' })).toBe(false);
    expect(crossFades({ ...NOW, chip: 'unknown' })).toBe(false);
  });

  it('never in Calm or Off, with reduced motion, as the show changes, for the same look, or without view transitions', () => {
    expect(crossFades({ ...NOW, motion: 'calm' })).toBe(false);
    expect(crossFades({ ...NOW, motion: 'off' })).toBe(false);
    expect(crossFades({ ...NOW, reduced: true })).toBe(false);
    expect(crossFades({ ...NOW, quiet: false })).toBe(false);
    expect(crossFades({ ...NOW, looksOtherwise: false })).toBe(false);
    expect(crossFades({ ...NOW, canFade: false })).toBe(false);
  });
});
