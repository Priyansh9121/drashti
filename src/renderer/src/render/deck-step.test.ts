import { describe, expect, it } from 'vitest';
import type { StepTiming } from '../../../shared/deck-show';
import { stepPhase } from './DeckStep';

/*
 * What a deck's step draws at a moment of the engine's time (Session 54, C2): its clip while it plays, then its last
 * frame, or its hold going round once that has a frame; its last frame at once when it is come back to, or when
 * Drashti's own transition comes instead of its motion; its last frame too when its clip cannot play.
 */

const timing = (more: Partial<StepTiming> = {}): StepTiming => ({
  index: 1,
  step: { clipId: 'c1', clipMs: 1000, lastId: 'l1', holdId: 'h1', holdMs: 500 },
  clipAt: 10_000,
  endsAt: 11_000,
  still: false,
  drashti: null,
  shownAt: 10_000,
  ...more,
});
const ready = { hold: true, clipFailed: false };

describe('what a deck’s step draws at a moment (Session 54, C2)', () => {
  it('its clip while it plays, then its hold once there is one (else its last frame), by the engine’s time', () => {
    expect(stepPhase(timing(), 10_500, ready)).toBe('clip');
    expect(stepPhase(timing(), 11_000, ready)).toBe('hold');
    expect(stepPhase(timing(), 11_000, { ...ready, hold: false })).toBe('held');
    expect(stepPhase(timing({ step: { clipId: 'c1', clipMs: 1000, lastId: 'l1' } }), 12_000, ready)).toBe(
      'held',
    );
  });

  it('its last frame at once when come back to, when its clip cannot play, or under Drashti’s transition instead', () => {
    expect(stepPhase(timing({ still: true, clipAt: 9000, endsAt: 10_000 }), 10_000, ready)).toBe('hold');
    expect(stepPhase(timing(), 10_500, { ...ready, clipFailed: true })).toBe('held');
    const instead = timing({
      drashti: { transition: { kind: 'dissolve', durationMs: 400 }, mode: 'instead' },
    });
    expect(stepPhase(instead, 10_200, ready)).toBe('held');
    expect(stepPhase(instead, 11_000, ready)).toBe('hold');
  });
});
