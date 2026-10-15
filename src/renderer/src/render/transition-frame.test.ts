import { describe, expect, it } from 'vitest';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { EASE } from './easing';
import {
  dissolveCurve,
  easeInOut,
  takesTime,
  transitionFrame,
  wordsFrame,
  wordsMove,
  zoomAt,
} from './transition-frame';

/* How each transition draws its two slides part-way (Session 26d): pure, so every screen draws the same. */

describe('a transition, part-way', () => {
  it('a fade: the old slide out and the new one in, the new one added light for light, eased (Calm)', () => {
    // Smoothstep: 0.25 in is 0.15625 of the way (Session 27; it was linear).
    expect(transitionFrame('dissolve', 0.25)).toEqual({
      in: { opacity: 0.15625, transform: '' },
      out: { opacity: 0.84375, transform: '' },
      black: 0,
      add: true,
    });
    expect(transitionFrame('dissolve', 0.5).in.opacity).toBe(0.5);
    expect(transitionFrame('dissolve', 1)).toMatchObject({ in: { opacity: 1 }, out: { opacity: 0 } });
  });

  it('a fade never dips or clips: in + out = 1 at 101 points, Calm and Bold, a slow zoom too (Session 27)', () => {
    for (const kind of ['dissolve', 'zoom'] as const)
      for (const movement of ['calm', 'bold'] as const)
        for (let i = 0; i <= 100; i++) {
          const f = transitionFrame(kind, i / 100, movement);
          expect(f.in.opacity + f.out.opacity, `${kind} ${movement} at ${String(i)}%`).toBeCloseTo(1, 12);
          if (i > 0)
            expect(f.in.opacity).toBeGreaterThanOrEqual(
              transitionFrame(kind, (i - 1) / 100, movement).in.opacity,
            );
        }
  });

  it('Bold eases in and out on its own curve, the same at the ends: only a group that chose it draws it', () => {
    expect(dissolveCurve('calm')).toBe(EASE.smooth);
    expect(dissolveCurve('bold')).toBe(EASE.inOut);
    const calm = transitionFrame('dissolve', 0.25, 'calm').in.opacity;
    const bold = transitionFrame('dissolve', 0.25, 'bold').in.opacity;
    expect(bold).toBeLessThan(calm);
    expect(transitionFrame('dissolve', 0.5, 'bold').in.opacity).toBeCloseTo(0.5, 6);
    expect(transitionFrame('dissolve', 1, 'bold')).toEqual(transitionFrame('dissolve', 1, 'calm'));
    expect(transitionFrame('dissolve', 0, 'bold')).toEqual(transitionFrame('dissolve', 0, 'calm'));
  });

  it('the cut, the fade through black and the slide draw the same whatever the Movement', () => {
    for (const kind of ['cut', 'fade-black', 'slide'] as const)
      for (const p of [0, 0.3, 0.7, 1])
        expect(transitionFrame(kind, p, 'bold')).toEqual(transitionFrame(kind, p, 'calm'));
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

describe('words apart while a Bold move runs (Session 27)', () => {
  it('Bold draws its words apart for its dissolve, wipe, push and zoom; Calm fades instead; both reveal lines and words', () => {
    expect(wordsMove('dissolve', 'bold')).toBe('settle');
    expect(wordsMove('wipe', 'bold')).toBe('wipe');
    expect(wordsMove('push', 'bold')).toBe('push');
    expect(wordsMove('zoom-dissolve', 'bold')).toBe('zoom');
    for (const kind of [
      'cut',
      'dissolve',
      'fade-black',
      'slide',
      'zoom',
      'wipe',
      'push',
      'zoom-dissolve',
    ] as const)
      expect(wordsMove(kind, 'calm'), kind).toBeNull();
    for (const kind of ['cut', 'fade-black', 'slide', 'zoom'] as const)
      expect(wordsMove(kind, 'bold'), kind).toBeNull();
    for (const movement of ['calm', 'bold'] as const) {
      expect(wordsMove('lines', movement)).toBe('lines');
      expect(wordsMove('words', movement)).toBe('words');
    }
  });

  it('never word by word on a kirtan’s slide, whatever the Look: its dissolve instead', () => {
    expect(wordsMove('words', 'bold', true)).toBe('settle');
    expect(wordsMove('words', 'calm', true)).toBeNull();
    expect(wordsMove('lines', 'calm', true)).toBe('lines');
  });

  it('every new kind’s pictures only dissolve, on the Movement’s curve: in + out = 1', () => {
    for (const kind of ['wipe', 'push', 'zoom-dissolve', 'lines', 'words'] as const)
      for (const movement of ['calm', 'bold'] as const)
        for (let i = 0; i <= 100; i++)
          expect(transitionFrame(kind, i / 100, movement)).toEqual(
            transitionFrame('dissolve', i / 100, movement),
          );
  });

  it('the push moves the words a screen’s width; the zoom grows them; the wipe’s diagonal edge crosses', () => {
    expect(wordsFrame('push', 0)).toMatchObject({
      in: { transform: 'translateX(100%)' },
      out: { transform: 'translateX(0%)' },
    });
    expect(wordsFrame('push', 1)).toMatchObject({
      in: { transform: '' },
      out: { transform: 'translateX(-100%)' },
    });
    expect(wordsFrame('zoom', 0)).toMatchObject({
      in: { opacity: 0, transform: 'scale(0.92)' },
      out: { opacity: 1, transform: 'scale(1)' },
    });
    expect(wordsFrame('zoom', 1)).toMatchObject({
      in: { opacity: 1, transform: '' },
      out: { opacity: 0, transform: 'scale(1.08)' },
    });
    const size = { width: 1920, height: 1080 };
    expect(wordsFrame('wipe', 0, size).in.clip).toBe('polygon(0 0, 0.0px 0, -302.4px 100%, 0 100%)');
    expect(wordsFrame('wipe', 0, size).out.clip).toBe('polygon(0.0px 0, 100% 0, 100% 100%, -302.4px 100%)');
    expect(wordsFrame('wipe', 1, size).in.clip).toBe('');
    expect(wordsFrame('lines', 0.5)).toEqual({
      in: { opacity: 1, transform: '', clip: '' },
      out: { opacity: 1, transform: '', clip: '' },
    });
  });

  it('Bold’s new words settle from 103% as they come in, on the pictures’ curve; in + out = 1', () => {
    expect(wordsFrame('settle', 0)).toEqual({
      in: { opacity: 0, transform: 'scale(1.03)', clip: '' },
      out: { opacity: 1, transform: '', clip: '' },
    });
    expect(wordsFrame('settle', 1)).toEqual({
      in: { opacity: 1, transform: '', clip: '' },
      out: { opacity: 0, transform: '', clip: '' },
    });
    for (let i = 0; i <= 100; i++) {
      const w = wordsFrame('settle', i / 100);
      expect(w.in.opacity + w.out.opacity).toBeCloseTo(1, 12);
      expect(w.in.opacity).toBeCloseTo(transitionFrame('dissolve', i / 100, 'bold').in.opacity, 12);
    }
  });
});
