import { describe, expect, it } from 'vitest';
import type { EngineState, Layers } from './state';
import { transitionsEndAt } from './transitions-running';

/*
 * When the screens' running transitions end (alpha.21, Q60-59 A): a new picture's display copy waits for it. A slide
 * coming on by a dissolve, a fade through black or a slide in, from its shownAt for its duration; the background's
 * dissolve from the one before, from its fade's start for its duration. Placeholder states only.
 */

const NOW = 1_000_000;
const state = (layers: Partial<Layers>): EngineState =>
  ({
    layers: {
      audio: null,
      background: null,
      slide: null,
      pip: null,
      lowerThird: null,
      messages: [],
      ticker: null,
      ...layers,
    },
  }) as unknown as EngineState;
const slide = (shownAt: number, transition?: { kind: string; durationMs: number }) =>
  ({ shownAt, ...(transition ? { transition } : {}) }) as unknown as Layers['slide'];
const background = (fade?: { at: number; durationMs: number }) =>
  ({ kind: 'media', ...(fade ? { fade } : {}) }) as unknown as Layers['background'];

describe('the screens’ running transitions', () => {
  it('end where the slide’s dissolve ends, while it runs', () => {
    const s = state({ slide: slide(NOW - 1000, { kind: 'dissolve', durationMs: 5000 }) });
    expect(transitionsEndAt(s, NOW)).toBe(NOW + 4000);
  });

  it('are none once it has ended, for a cut, or with nothing up', () => {
    expect(
      transitionsEndAt(state({ slide: slide(NOW - 6000, { kind: 'dissolve', durationMs: 5000 }) }), NOW),
    ).toBe(null);
    expect(transitionsEndAt(state({ slide: slide(NOW - 10, { kind: 'cut', durationMs: 0 }) }), NOW)).toBe(
      null,
    );
    expect(transitionsEndAt(state({ slide: slide(NOW - 10) }), NOW)).toBe(null);
    expect(transitionsEndAt(state({}), NOW)).toBe(null);
    expect(transitionsEndAt(null, NOW)).toBe(null);
  });

  it('take the background’s dissolve too, and the later of the two', () => {
    const s = state({
      slide: slide(NOW - 1000, { kind: 'dissolve', durationMs: 2000 }),
      background: background({ at: NOW - 500, durationMs: 3000 }),
    });
    expect(transitionsEndAt(s, NOW)).toBe(NOW + 2500);
    expect(
      transitionsEndAt(state({ background: background({ at: NOW - 4000, durationMs: 3000 }) }), NOW),
    ).toBe(null);
  });
});
