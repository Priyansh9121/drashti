import { describe, expect, it } from 'vitest';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { easeInOut, takesTime, transitionFrame, zoomAt } from './transition-frame';

/* How each transition draws its two slides part-way (Session 26d): pure, so every screen draws the same. */

describe('a transition, part-way', () => {
  it('a fade: the old slide out and the new one in, the new one added light for light', () => {
    expect(transitionFrame('dissolve', 0.25)).toEqual({
      in: { opacity: 0.25, transform: '' },
      out: { opacity: 0.75, transform: '' },
      black: 0,
      add: true,
    });
  });

  it('a fade through black: black over the old slide until half-way, then going from over the new one', () => {
    expect(transitionFrame('fade-black', 0)).toMatchObject({
      in: { opacity: 0 },
      out: { opacity: 1 },
      black: 0,
    });
    expect(transitionFrame('fade-black', 0.25)).toMatchObject({
      in: { opacity: 0 },
      out: { opacity: 1 },
      black: 0.5,
    });
    expect(transitionFrame('fade-black', 0.5)).toMatchObject({
      in: { opacity: 1 },
      out: { opacity: 0 },
      black: 1,
    });
    expect(transitionFrame('fade-black', 0.75)).toMatchObject({
      in: { opacity: 1 },
      out: { opacity: 0 },
      black: 0.5,
    });
    expect(transitionFrame('fade-black', 1)).toMatchObject({ in: { opacity: 1 }, black: 0, add: false });
  });

  it('a slide: the new one in from the right as the old goes out to the left, easing in and out', () => {
    expect(transitionFrame('slide', 0)).toMatchObject({
      in: { opacity: 1, transform: 'translateX(100%)' },
      out: { transform: 'translateX(0%)' },
    });
    expect(transitionFrame('slide', 0.5)).toMatchObject({
      in: { transform: 'translateX(50%)' },
      out: { transform: 'translateX(-50%)' },
      add: false,
    });
    expect(transitionFrame('slide', 1).in.transform).toBe('');
    expect(easeInOut(0.25)).toBeCloseTo(0.125);
    expect(easeInOut(0.75)).toBeCloseTo(0.875);
  });

  it('a slow zoom fades, and its slide grows from when it came on, over its span, then holds', () => {
    expect(transitionFrame('zoom', 0.5)).toMatchObject({ in: { opacity: 0.5 }, add: true });
    const t = { kind: 'zoom' as const, durationMs: 1000, spanMs: 16_000 };
    expect(zoomAt(t, 5000, 5000)).toBe(1);
    expect(zoomAt(t, 5000, 13_000)).toBeCloseTo(1 + (SLOW_ZOOM_SCALE - 1) / 2);
    expect(zoomAt(t, 5000, 99_000)).toBeCloseTo(SLOW_ZOOM_SCALE);
    // No span of its own: SLOW_ZOOM_MS.
    expect(zoomAt({ kind: 'zoom', durationMs: 1000 }, 0, SLOW_ZOOM_MS / 4)).toBeCloseTo(
      1 + (SLOW_ZOOM_SCALE - 1) / 4,
    );
    expect(zoomAt({ kind: 'dissolve', durationMs: 1000 }, 0, 5000)).toBe(1);
  });

  it('out of range is clamped; a cut, or one of no length, takes no time', () => {
    expect(transitionFrame('dissolve', -1).in.opacity).toBe(0);
    expect(transitionFrame('dissolve', 2).in.opacity).toBe(1);
    expect(takesTime({ kind: 'cut', durationMs: 0 })).toBe(false);
    expect(takesTime({ kind: 'slide', durationMs: 0 })).toBe(false);
    expect(takesTime({ kind: 'fade-black', durationMs: 300 })).toBe(true);
    expect(takesTime(undefined)).toBe(false);
  });
});
