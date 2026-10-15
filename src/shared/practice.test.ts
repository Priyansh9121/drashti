import { describe, expect, it } from 'vitest';
import type { Practice } from './practice';
import {
  PRACTICE_ID,
  PRACTICE_LOGO,
  PRACTICE_START,
  practiceSlides,
  practiceState,
  practiceStep,
} from './practice';

/*
 * The practice show (Session 26g): Next, Back, Black-out, Logo, Clear all and Put it back as in a
 * show, on placeholder slides, as a state the operator window draws and nothing else ever sees.
 */

const run = (...actions: Parameters<typeof practiceStep>[1][]): Practice =>
  actions.reduce<Practice>((p, a) => practiceStep(p, a), PRACTICE_START);

describe('the practice show', () => {
  it('has placeholder slides only, in English, Gujarati and Hindi', () => {
    const slides = practiceSlides();
    expect(slides).toHaveLength(5);
    for (const s of slides) {
      const words = s.elements.map((e) => (e.kind === 'text' ? e.text : '')).join(' ');
      expect(words).toMatch(/Practice slide/u);
      expect(s.elements.map((e) => (e.kind === 'text' ? e.lang : null))).toEqual(['gu', 'hi', 'en']);
    }
    expect(PRACTICE_LOGO.name).toBe('Placeholder logo');
  });

  it('Next starts at the first slide and goes on; Back goes back; neither runs off the ends', () => {
    expect(run('next').index).toBe(0);
    expect(run('next', 'next', 'next').index).toBe(2);
    expect(run('next', 'next', 'previous').index).toBe(0);
    expect(run('next', 'back').index).toBe(0);
    expect(run('next', 'next', 'next', 'next', 'next', 'next', 'next').index).toBe(4);
    expect(run('previous').index).toBeNull();
    expect(run({ goTo: 3 }).index).toBe(3);
    expect(run({ goTo: 9 }).index).toBeNull();
  });

  it('Clear all takes the slide down and Put it back brings it back, until something else goes up', () => {
    const cleared = run('next', 'next', 'clearAll');
    expect(cleared.index).toBeNull();
    expect(practiceState(cleared).canPutBack).toBe(true);
    expect(practiceStep(cleared, 'putBack').index).toBe(1);
    const moved = practiceStep(cleared, 'next');
    expect(moved.index).toBe(0);
    expect(practiceState(moved).canPutBack).toBe(false);
    expect(run('next', 'clearSlide').cleared).toBeNull();
  });

  it('Black-out and the logo cover the slide without clearing it', () => {
    const p = run('next', 'toggleBlackout', 'toggleLogo');
    const state = practiceState(p);
    expect(state.blackout).toBe(true);
    expect(state.logo).toEqual(PRACTICE_LOGO);
    expect(state.layers.slide?.slideIndex).toBe(0);
    const back = practiceState(run('next', 'toggleBlackout', 'toggleBlackout'));
    expect(back.blackout).toBe(false);
  });

  it('draws as an engine state of its own: the practice presentation, what comes next, nothing else', () => {
    const state = practiceState(run('next'));
    expect(state.live).toMatchObject({ presentationId: PRACTICE_ID, slideIndex: 0, slideCount: 5 });
    expect(state.layers.slide?.presentationId).toBe(PRACTICE_ID);
    expect(state.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(state.layers.background).toBeNull();
    expect(state.layers.props).toEqual([]);
    expect(practiceState(PRACTICE_START).layers.slide).toBeNull();
    // Every step counts, so the window draws again.
    expect(run('next', 'next').rev).toBe(2);
    expect(practiceStep(PRACTICE_START, 'previous')).toBe(PRACTICE_START);
  });
});
