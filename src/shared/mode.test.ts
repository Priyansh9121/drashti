import { describe, expect, it } from 'vitest';
import {
  SIMPLE_ACCESS_LOCKED_REFUSAL,
  SIMPLE_MODE_REFUSAL,
  SIMPLE_MODE_WAY_OUT,
  SIMPLE_PHONE_REFUSAL_START,
  simplePhoneRefusalText,
  startingMode,
} from './mode';

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

describe('what a phone is told in Simple Mode (Session 55, the owner’s answer of 30 Oct 2026)', () => {
  it('starts “Simple Mode on Drashti’s computer”, says what a phone does there, and the way out in the window’s own words', () => {
    expect(SIMPLE_PHONE_REFUSAL_START).toBe('Simple Mode on Drashti’s computer');
    const words = simplePhoneRefusalText(false);
    expect(words).toBe(
      'Simple Mode on Drashti’s computer: a phone does only what Simple Mode does there (playlists, playback and Audio). On the Drashti computer, a double-click on Pro Mode leaves it.',
    );
    // The way out word for word as the window's own refusal says it.
    expect(SIMPLE_MODE_REFUSAL.endsWith(` ${SIMPLE_MODE_WAY_OUT}`)).toBe(true);
    expect(words.endsWith(` ${SIMPLE_MODE_WAY_OUT}`)).toBe(true);
  });

  it('with Simple access says so and names no way to Pro Mode (Part 19)', () => {
    const words = simplePhoneRefusalText(true);
    expect(words).toBe(
      'Simple Mode on Drashti’s computer, whose access is Simple Mode only: a phone does only what Simple Mode does there (playlists, playback and Audio).',
    );
    expect(words).not.toMatch(/double-click|Pro Mode|Switch to/u);
  });
});
