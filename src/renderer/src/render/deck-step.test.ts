import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../../shared/deck';
import type { StepTiming } from '../../../shared/deck-show';
import { DeckStepView, stepPhase } from './DeckStep';

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

describe('a baked deck prepares its next click', () => {
  it('mounts one muted video for the next step before Next', () => {
    const current = timing();
    const steps = [
      { clipId: 'c0', lastId: 'l0', clipMs: 1000 },
      current.step,
      { clipId: 'c2', lastId: 'l2', clipMs: 700 },
    ];
    const html = renderToStaticMarkup(
      createElement(DeckStepView, {
        deck: { steps, media: [] },
        timing: current,
        style: {},
      }),
    );
    expect(html.match(/data-deck-video="preparing"/gu)).toHaveLength(1);
    expect(html).toMatch(/<video[^>]*data-deck-video="preparing"[^>]*data-media-id="c2"[^>]*>/u);
  });

  it('prepares none after the last click, for a click with no motion, or one Drashti’s own transition comes instead of', () => {
    const current = timing();
    const preparing = (deck: DeckSlide, at: StepTiming = current) =>
      renderToStaticMarkup(createElement(DeckStepView, { deck, timing: at, style: {} })).match(
        /data-deck-video="preparing"/gu,
      )?.length ?? 0;
    const first = { clipId: 'c0', lastId: 'l0', clipMs: 1000 };
    const next = { clipId: 'c2', lastId: 'l2', clipMs: 700 };
    // The last click: nothing comes after it on this slide (the next slide's first clip is the Preloader's).
    expect(preparing({ steps: [first, current.step], media: [] })).toBe(0);
    // A click with no motion is shown still: its clip is never played.
    expect(preparing({ steps: [first, current.step, { ...next, clipMs: 0 }], media: [] })).toBe(0);
    // Drashti's own transition instead of the next click's motion: never played; over it, played (so prepared).
    const own = (mode: 'instead' | 'over') => ({
      steps: [first, current.step, next],
      media: [],
      stepTransitions: { 2: { transition: { kind: 'dissolve' as const, durationMs: 400 }, mode } },
    });
    expect(preparing(own('instead'))).toBe(0);
    expect(preparing(own('over'))).toBe(1);
    // Come back to still (Back), the next click still waits loaded.
    expect(preparing({ steps: [first, current.step, next], media: [] }, timing({ still: true }))).toBe(1);
  });
});

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
