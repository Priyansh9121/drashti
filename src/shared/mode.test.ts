import { describe, expect, it } from 'vitest';
import { startingMode } from './mode';

describe('the mode Drashti starts in (Session 20)', () => {
  it('is Pro Mode after a clean quit, whatever mode Drashti was quit in', () => {
    expect(startingMode({ recentStop: false, rolesOn: false, wasIn: 'simple' })).toBe('pro');
    expect(startingMode({ recentStop: false, rolesOn: false, wasIn: 'pro' })).toBe('pro');
  });

  it('is Simple Mode after a clean quit with roles on: Pro Mode takes a PIN', () => {
    expect(startingMode({ recentStop: false, rolesOn: true, wasIn: 'pro' })).toBe('simple');
    expect(startingMode({ recentStop: false, rolesOn: true, wasIn: 'simple' })).toBe('simple');
  });

  it('is the mode it was in after a recent unexpected stop, with roles on or off', () => {
    for (const rolesOn of [false, true]) {
      expect(startingMode({ recentStop: true, rolesOn, wasIn: 'simple' })).toBe('simple');
      expect(startingMode({ recentStop: true, rolesOn, wasIn: 'pro' })).toBe('pro');
    }
  });
});
