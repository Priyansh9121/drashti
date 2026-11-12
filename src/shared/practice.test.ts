import { describe, expect, it } from 'vitest';
import type { Practice } from './practice';
import { PRACTICE_ID, PRACTICE_START, practiceSlides, practiceState, practiceStep } from './practice';

/*
 * The practice show (Session 26g): Next, Back, Black-out, the Wallpaper (the Logo's place since Session 55), Clear
 * all and Put it back as in a
 * show, on placeholder slides, as a state the operator window draws and nothing else ever sees. Black-out and the
 * Wallpaper take each other off, as in a show (Session 57).
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

  it('Black-out and the Wallpaper cover the slide without clearing it', () => {
    const p = run('next', 'toggleBlackout');
    const state = practiceState(p);
    expect(state.blackout).toBe(true);
    expect(state.wallpaper).toBe(false);
    expect(state.layers.slide?.slideIndex).toBe(0);
    const back = practiceState(run('next', 'toggleBlackout', 'toggleBlackout'));
    expect(back.blackout).toBe(false);
    const wallpaper = practiceState(run('next', 'toggleWallpaper'));
    expect(wallpaper).toMatchObject({ blackout: false, wallpaper: true });
    expect(wallpaper.layers.slide?.slideIndex).toBe(0);
  });

  it('shows one cover at a time, as a show does: the one put on last takes the other off, in one step', () => {
    const covers = (p: Practice) => ({ blackout: p.blackout, wallpaper: p.wallpaper });
    const blackout = run('next', 'toggleBlackout');
    const wallpaper = practiceStep(blackout, 'toggleWallpaper');
    expect(covers(wallpaper)).toEqual({ blackout: false, wallpaper: true });
    expect(wallpaper.rev).toBe(blackout.rev + 1);
    const again = practiceStep(wallpaper, 'toggleBlackout');
    expect(covers(again)).toEqual({ blackout: true, wallpaper: false });
    // The last one off: the slide as it was, Put it back still offered after Clear all.
    expect(covers(practiceStep(again, 'toggleBlackout'))).toEqual({ blackout: false, wallpaper: false });
    expect(practiceStep(again, 'toggleBlackout').index).toBe(0);
    const cleared = run('next', 'clearAll', 'toggleWallpaper', 'toggleBlackout');
    expect(covers(cleared)).toEqual({ blackout: true, wallpaper: false });
    expect(practiceState(cleared).canPutBack).toBe(true);
  });

  it('takes the covers off when a practice slide goes up', () => {
    const uncovered = { blackout: false, wallpaper: false };
    expect(run('toggleBlackout', 'next')).toMatchObject({ index: 0, ...uncovered });
    expect(run({ goTo: 1 }, 'toggleWallpaper', 'back')).toMatchObject({ index: 0, ...uncovered });
    expect(run('toggleBlackout', { goTo: 2 })).toMatchObject({ index: 2, ...uncovered });
    expect(run({ goTo: 2 }, 'clearAll', 'toggleWallpaper', 'putBack')).toMatchObject({
      index: 2,
      ...uncovered,
    });

    const first = run('next', 'toggleBlackout');
    expect(practiceStep(first, 'back')).toBe(first);
    expect(practiceStep(first, { goTo: 9 })).toBe(first);
  });

  it('draws as an engine state of its own: the practice presentation, what comes next, nothing else', () => {
    const state = practiceState(run('next'));
    expect(state.live).toMatchObject({ presentationId: PRACTICE_ID, slideIndex: 0, slideCount: 5 });
    expect(state.layers.slide?.presentationId).toBe(PRACTICE_ID);
    expect(state.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(state.layers.background).toBeNull();
    expect(state.layers.messages).toEqual([]);
    expect(practiceState(PRACTICE_START).layers.slide).toBeNull();
    // Every step counts, so the window draws again.
    expect(run('next', 'next').rev).toBe(2);
    expect(practiceStep(PRACTICE_START, 'previous')).toBe(PRACTICE_START);
  });
});
