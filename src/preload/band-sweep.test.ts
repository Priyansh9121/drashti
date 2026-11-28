import { describe, expect, it } from 'vitest';
import { bandSweeps } from './band-sweep';

/* The band’s existing decorative sweep keeps its gates; it is independent of document snapshots. */
const NOW = {
  looksOtherwise: true,
  motion: 'lively',
  chip: 'yes',
  quiet: true,
  reduced: false,
} as const;

describe('the decorative appearance band', () => {
  it('sweeps in Lively with a graphics chip', () => {
    expect(bandSweeps(NOW)).toBe(true);
  });

  it('never without a known chip', () => {
    expect(bandSweeps({ ...NOW, chip: 'no' })).toBe(false);
    expect(bandSweeps({ ...NOW, chip: 'unknown' })).toBe(false);
  });

  it('never in Calm or Off, with reduced motion, as the show changes, or for the same look', () => {
    expect(bandSweeps({ ...NOW, motion: 'calm' })).toBe(false);
    expect(bandSweeps({ ...NOW, motion: 'off' })).toBe(false);
    expect(bandSweeps({ ...NOW, reduced: true })).toBe(false);
    expect(bandSweeps({ ...NOW, quiet: false })).toBe(false);
    expect(bandSweeps({ ...NOW, looksOtherwise: false })).toBe(false);
  });
});
