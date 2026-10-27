import { describe, expect, it } from 'vitest';
import { leaveSimpleRefusal, startingMode } from './mode';

describe('the mode Drashti starts in (Sessions 20 and 46)', () => {
  it('is Pro Mode after a clean quit, whatever mode Drashti was quit in', () => {
    expect(startingMode({ recentStop: false, wasIn: 'simple' })).toBe('pro');
    expect(startingMode({ recentStop: false, wasIn: 'pro' })).toBe('pro');
  });

  it('is the mode it was in after a recent unexpected stop', () => {
    expect(startingMode({ recentStop: true, wasIn: 'simple' })).toBe('simple');
    expect(startingMode({ recentStop: true, wasIn: 'pro' })).toBe('pro');
  });
});

describe('leaving Simple Mode (Sessions 20 and 54)', () => {
  it('takes the word typed on purpose, never a PIN (Session 54, E5: roles and PINs are gone)', () => {
    for (const typed of ['pro', 'PRO', ' Pro ']) expect(leaveSimpleRefusal(typed), typed).toBeNull();
    for (const typed of ['481526', '', 'yes', 'pro mode', undefined, null, 42])
      expect(leaveSimpleRefusal(typed), String(typed)).toBe('Type pro to switch to Pro Mode.');
  });
});
