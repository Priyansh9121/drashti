import { describe, expect, it } from 'vitest';
import { SIMPLE_ACCESS_LOCKED_REFUSAL, SIMPLE_MODE_REFUSAL, startingMode } from './mode';

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

describe('leaving Simple Mode (Sessions 20 and 54; Session 55, Part 18: a double-click, no typing)', () => {
  it('needs nothing typed: Simple Mode’s refusal says the double-click on Pro Mode, never a word or a PIN', () => {
    // The owner's answer to question 12, changed on 29 Oct 2026: a double-click on Pro Mode, with no typing.
    expect(SIMPLE_MODE_REFUSAL).toContain('double-click on Pro Mode');
    expect(SIMPLE_MODE_REFUSAL).not.toMatch(/\btype|\bword\b|PIN|Switch to Pro Mode…/iu);
    // With Simple access no way to Pro Mode is offered, in words either (Part 19).
    expect(SIMPLE_ACCESS_LOCKED_REFUSAL).not.toMatch(/double-click|Switch to Pro Mode/iu);
  });
});
