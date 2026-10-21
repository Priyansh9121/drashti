import { describe, expect, it } from 'vitest';
import { startingMode } from './mode';

describe('the mode Drashti starts in (Sessions 20 and 46)', () => {
  it('is Pro Mode after a clean quit, whatever mode Drashti was quit in, with roles on too: it asks nothing of them (Session 46: as the operator, admin locked, no PIN asked)', () => {
    expect(startingMode({ recentStop: false, wasIn: 'simple' })).toBe('pro');
    expect(startingMode({ recentStop: false, wasIn: 'pro' })).toBe('pro');
  });

  it('is the mode it was in after a recent unexpected stop', () => {
    expect(startingMode({ recentStop: true, wasIn: 'simple' })).toBe('simple');
    expect(startingMode({ recentStop: true, wasIn: 'pro' })).toBe('pro');
  });
});
