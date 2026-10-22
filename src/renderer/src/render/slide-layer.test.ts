import { describe, expect, it } from 'vitest';
import type { SlideLayer } from '../../../shared/engine/state';
import { fadeAt, nextShowing } from './SlideLayerView';

const layer = (id: string, shownAt: number, transition?: SlideLayer['transition']): SlideLayer => ({
  presentationId: 'p',
  slideIndex: 0,
  slide: { id, width: 1920, height: 1080, background: null, elements: [] },
  shownAt,
  notes: '',
  ...(transition ? { transition } : {}),
});
const none = { on: null, off: null, fade: null };

describe('the slide layer on a screen', () => {
  it('cuts, or dissolves from the slide that was up while there is time left', () => {
    const a = layer('a', 1000);
    const shown = nextShowing(none, a, 1000);
    expect(shown).toEqual({ on: a, off: null, fade: null });
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    expect(nextShowing(shown, b, 2010)).toEqual({
      on: b,
      off: a,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
    // A screen that hears of it after the dissolve has finished just shows it.
    expect(nextShowing(shown, b, 2900)).toEqual({ on: b, off: null, fade: null });
  });

  it('does not fade again for the same slide with new content, and clears at once', () => {
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    const fading = {
      on: b,
      off: layer('a', 1000),
      fade: { kind: 'dissolve' as const, ms: 800, start: 2000 },
    };
    const edited = { ...b, notes: 'Placeholder note' };
    expect(nextShowing(fading, edited, 2100)).toEqual({ ...fading, on: edited });
    expect(nextShowing(fading, null, 2100)).toEqual(none);
  });

  it('a slide still waiting for its pictures never becomes the one going away: what is on screen does (Session 23)', () => {
    const a = layer('a', 1000);
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    const c = layer('c', 2100, { kind: 'dissolve', durationMs: 800 });
    // b waits for its pictures: a is still the slide on screen.
    const waiting = nextShowing({ on: a, off: null, fade: null }, b, 2010);
    expect(waiting).toEqual({ on: b, off: a, fade: { kind: 'dissolve', ms: 800, start: null } });
    // c comes before b has begun to fade in: it dissolves from a, never from b (which was never seen).
    expect(nextShowing(waiting, c, 2110)).toEqual({
      on: c,
      off: a,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
    // Once b had begun, b is what goes.
    const begun = { ...waiting, fade: { kind: 'dissolve' as const, ms: 800, start: 2000 } };
    expect(nextShowing(begun, c, 2110)).toEqual({
      on: c,
      off: b,
      fade: { kind: 'dissolve', ms: 800, start: null },
    });
  });

  it('runs every transition that takes time, each by its kind; a cut, or one of no length, just shows (Session 26d)', () => {
    const a = layer('a', 1000);
    const shown = nextShowing(none, a, 1000);
    for (const kind of ['fade-black', 'slide', 'zoom'] as const) {
      const b = layer('b', 2000, { kind, durationMs: 1000 });
      expect(nextShowing(shown, b, 2010)).toEqual({ on: b, off: a, fade: { kind, ms: 1000, start: null } });
    }
    expect(nextShowing(shown, layer('b', 2000, { kind: 'slide', durationMs: 0 }), 2010).fade).toBeNull();
    expect(nextShowing(shown, layer('b', 2000, { kind: 'cut', durationMs: 0 }), 2010).fade).toBeNull();
  });

  it('works out how far a dissolve is from the clock', () => {
    expect(fadeAt({ ms: 1000, start: 5000 }, 4000)).toBe(0);
    expect(fadeAt({ ms: 1000, start: 5000 }, 5250)).toBe(0.25);
    expect(fadeAt({ ms: 1000, start: 5000 }, 9000)).toBe(1);
  });
});

describe('a timer shown alone on a screen (Session 50)', () => {
  const timer = (shownAt: number): SlideLayer => ({
    ...layer('timer:t1', shownAt, { kind: 'push', durationMs: 600 }),
    presentationId: 'timer:t1',
    timer: { timerId: 't1', name: 'Placeholder countdown' },
  });

  it('goes off with its transition’s length, fading from when it was taken off', () => {
    const t = timer(1000);
    const up = { on: t, off: null, fade: null };
    expect(nextShowing(up, null, 5010, { layer: t, at: 5000 })).toEqual({
      on: null,
      off: t,
      fade: { kind: 'dissolve', ms: 600, start: 5000 },
    });
    // A screen that hears of it once the fade is over, or never saw it: nothing to fade.
    expect(nextShowing(up, null, 5600, { layer: t, at: 5000 })).toEqual(none);
    expect(nextShowing(none, null, 5010, { layer: t, at: 5000 })).toEqual(none);
  });

  it('any other slide taken off, or Clear all (nothing leaving), goes at once', () => {
    const a = layer('a', 1000, { kind: 'dissolve', durationMs: 600 });
    expect(nextShowing({ on: a, off: null, fade: null }, null, 5010, { layer: a, at: 5000 })).toEqual(none);
    const t = timer(1000);
    expect(nextShowing({ on: t, off: null, fade: null }, null, 5010, null)).toEqual(none);
    // Another timer than the one on this screen: not this one's out.
    const other = { ...timer(2000), slide: { ...t.slide, id: 'timer:t2' } };
    expect(nextShowing({ on: t, off: null, fade: null }, null, 5010, { layer: other, at: 5000 })).toEqual(
      none,
    );
  });
});
