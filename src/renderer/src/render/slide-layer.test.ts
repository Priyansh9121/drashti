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
    expect(nextShowing(shown, b, 2010)).toEqual({ on: b, off: a, fade: { ms: 800, start: null } });
    // A screen that hears of it after the dissolve has finished just shows it.
    expect(nextShowing(shown, b, 2900)).toEqual({ on: b, off: null, fade: null });
  });

  it('does not fade again for the same slide with new content, and clears at once', () => {
    const b = layer('b', 2000, { kind: 'dissolve', durationMs: 800 });
    const fading = { on: b, off: layer('a', 1000), fade: { ms: 800, start: 2000 } };
    const edited = { ...b, notes: 'Placeholder note' };
    expect(nextShowing(fading, edited, 2100)).toEqual({ ...fading, on: edited });
    expect(nextShowing(fading, null, 2100)).toEqual(none);
  });

  it('works out how far a dissolve is from the clock', () => {
    expect(fadeAt({ ms: 1000, start: 5000 }, 4000)).toBe(0);
    expect(fadeAt({ ms: 1000, start: 5000 }, 5250)).toBe(0.25);
    expect(fadeAt({ ms: 1000, start: 5000 }, 9000)).toBe(1);
  });
});
