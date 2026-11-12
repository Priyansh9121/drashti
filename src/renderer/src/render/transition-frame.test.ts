import { describe, expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { EASE } from './easing';
import {
  deckTransitionFrame,
  dissolveCurve,
  easeInOut,
  type SlideFrame,
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

/*
 * A deck's own PowerPoint transitions against PowerPoint's own movie of a generated deck (the comparison's run 1, made
 * 12 Nov 2026 and measured frame by frame on 13 Nov at 320 x 180): a red slide with a yellow box, then a blue one with
 * a green box coming in over 700 ms. Each list holds pairs: ms into the transition, then where PowerPoint's moving
 * edge is, in px from the incoming slide's own side (Cover: the incoming slide's edge; Uncover: the outgoing's).
 */
const MOVIE: Readonly<Record<string, readonly number[]>> = {
  'cover left': [
    0, 0, 33.3, 0, 66.7, 0, 98.3, 0.71, 131.7, 5.71, 165, 12.99, 198.3, 21.71, 231.7, 34.74, 263.3, 55.23,
    296.7, 88.24, 330, 131.99, 363.3, 179.99, 396.7, 225.74, 428.3, 261, 461.7, 283.99, 495, 298.22, 528.3,
    306.99, 561.7, 312.73, 593.3, 316.71, 626.7, 318.73, 660, 320, 693.3, 320, 726.7, 320,
  ],
  'cover right': [
    0, 0, 33.3, 0, 66.7, 0, 100, 0.72, 133.3, 5.98, 165, 12.99, 198.3, 21.99, 231.7, 34.74, 265, 55.76, 298.3,
    88.24, 330, 131.99, 363.3, 180.01, 396.7, 225.74, 430, 261, 463.3, 283.99, 495, 298.24, 528.3, 306.99,
    561.7, 312.99, 595, 316.74, 628.3, 318.99, 660, 320, 693.3, 320, 726.7, 320,
  ],
  'cover up': [
    0, 0, 33.3, 0, 65, 0, 98.3, 0, 131.7, 3.24, 165, 7.73, 198.3, 13.74, 230, 22.23, 263.3, 34.73, 296.7,
    53.73, 330, 77.99, 363.3, 104.74, 395, 129.72, 428.3, 148.98, 461.7, 161.23, 495, 168.74, 528.3, 173, 560,
    175.99, 593.3, 178.23, 626.7, 179.22, 660, 180, 693.3, 180, 725, 180,
  ],
  'cover down': [
    0, 0, 33.3, 0, 66.7, 0, 100, 0, 131.7, 3.23, 165, 8, 198.3, 13.99, 231.7, 22.26, 265, 34.99, 296.7, 53.74,
    330, 78, 363.3, 104.74, 396.7, 129.72, 430, 149.23, 461.7, 161.75, 495, 168.99, 528.3, 173.24, 561.7,
    176.22, 595, 178.24, 626.7, 179.22, 660, 180, 693.3, 180, 726.7, 180,
  ],
  'uncover left': [
    0, 0, 31.7, 0.75, 65, 2.75, 98.3, 6.25, 131.7, 12.75, 165, 21, 196.7, 31.75, 230, 46.24, 263.3, 67.74,
    296.7, 99.25, 330, 139.73, 361.7, 184, 395, 225.99, 428.3, 259, 461.7, 281, 495, 295.22, 526.7, 305, 560,
    312.75, 593.3, 318.24, 626.7, 320, 660, 320, 691.7, 320, 725, 320,
  ],
  'uncover right': [
    0, 0, 33.3, 0.75, 66.7, 2.75, 98.3, 6.75, 131.7, 12.75, 165, 21, 198.3, 31.75, 231.7, 46.24, 263.3, 68,
    296.7, 99.25, 330, 140, 363.3, 184.25, 396.7, 226.27, 428.3, 259.26, 461.7, 281.23, 495, 295.25, 528.3,
    305, 561.7, 312.76, 593.3, 318.25, 626.7, 320, 660, 320, 693.3, 320, 726.7, 320,
  ],
  'uncover up': [
    0, 0, 33.3, 0, 66.7, 0.71, 100, 2, 133.3, 5, 165, 9, 198.3, 14, 231.7, 21.76, 265, 33.75, 298.3, 52, 330,
    76, 363.3, 102.75, 396.7, 127.74, 430, 147.24, 463.3, 160, 495, 168, 528.3, 172.74, 561.7, 176.23, 595,
    178.24, 628.3, 180, 660, 180, 693.3, 180, 726.7, 180,
  ],
  'uncover down': [
    0, 0, 33.3, 0, 65, 0.75, 98.3, 2.23, 131.7, 5, 165, 9, 198.3, 14.24, 230, 21.75, 263.3, 33.75, 296.7, 52,
    330, 76, 363.3, 102.75, 395, 128, 428.3, 147.24, 461.7, 160.24, 495, 168, 528.3, 173, 560, 176.24, 593.3,
    178.75, 626.7, 180, 660, 180, 693.3, 180, 725, 180,
  ],
};

type Direction = NonNullable<DeckNativeTransition['direction']>;
const deckNative = (
  deckEffect: DeckNativeTransition['deckEffect'],
  direction: Direction,
): DeckNativeTransition => ({
  kind: deckEffect === 'wipe' ? 'wipe' : 'slide',
  deckEffect,
  durationMs: 700,
  direction,
});
/** A slide's shift along its axis in px at `size` (translateX or translateY in %; 0 for none). */
const shiftOf = (f: SlideFrame, size: number): number => {
  const m = /^translate[XY]\((-?[\d.e+-]+)%\)$/u.exec(f.transform);
  return m ? (Number(m[1]) / 100) * size : 0;
};
/** The measured frames of an effect: its direction, size along it, and each [ms, px] pair. */
function movie(effect: string): { direction: Direction; size: number; frames: [number, number][] }[] {
  return Object.entries(MOVIE)
    .filter(([name]) => name.startsWith(`${effect} `))
    .map(([name, list]) => {
      const direction = name.slice(effect.length + 1) as Direction;
      const frames: [number, number][] = [];
      for (let k = 0; k + 1 < list.length; k += 2) frames.push([list[k] ?? 0, list[k + 1] ?? 0]);
      return { direction, size: direction === 'left' || direction === 'right' ? 320 : 180, frames };
    });
}

describe('a deck’s own Cover and Uncover, against PowerPoint’s own movie (13 Nov 2026)', () => {
  it('the slide that moves (Cover’s incoming, Uncover’s outgoing) is where PowerPoint’s is, within a pixel at 320 x 180, every frame, every direction', () => {
    for (const effect of ['cover', 'uncover'] as const)
      for (const { direction, size, frames } of movie(effect)) {
        // The incoming comes from the right (left), the bottom (up), the left (right) or the top (down); the outgoing
        // goes that way.
        const toward = direction === 'left' || direction === 'up' ? -1 : 1;
        const t = deckNative(effect, direction);
        for (const [ms, edge] of frames) {
          const f = deckTransitionFrame(t, ms / 700);
          const at = effect === 'cover' ? size + toward * shiftOf(f.in, size) : toward * shiftOf(f.out, size);
          expect(Math.abs(at - edge), `${effect} ${direction} at ${String(ms)} ms`).toBeLessThanOrEqual(1.25);
          // The other slide stays where it is.
          expect((effect === 'cover' ? f.out : f.in).transform).toBe('');
        }
      }
  });
});

/*
 * PowerPoint's Wipe in the same movie: triples of ms into the transition, the incoming slide's edge (where it shows
 * half, px from its own side; 0 or the whole size while that point is off the screen) and how much of the slide it
 * shows (px of its length, summed).
 */
const WIPE: Readonly<Record<Direction, { frames: readonly number[] }>> = {
  left: {
    frames: [
      0, 0, 0, 33.3, 0, 0.13, 66.7, 0, 1.66, 100, 0, 5.6, 133.3, 0, 12.99, 165, 0, 24.67, 198.3, 22, 40.8,
      231.7, 51, 60.96, 265, 81, 84.8, 298.3, 112.25, 112.26, 330, 142, 141.79, 363.3, 172.25, 172.03, 396.7,
      201.75, 201.15, 430, 231.33, 229.12, 463.3, 262, 254.27, 495, 292.25, 275.58, 528.3, 320, 292.29, 561.7,
      320, 304.83, 595, 320, 313.06, 628.3, 320, 317.73, 660, 320, 319.62, 693.3, 320, 319.97, 726.7, 320,
      319.97,
    ],
  },
  right: {
    frames: [
      0, 0, 0.13, 33.3, 0, 0.16, 65, 0, 1.57, 98.3, 0, 5.79, 131.7, 0, 13.06, 165, 0, 24.96, 198.3, 22, 40.7,
      230, 52.25, 61.02, 263.3, 81, 85.06, 296.7, 111.03, 112.38, 330, 142, 141.89, 363.3, 171.33, 172.16,
      395, 202, 201.63, 428.3, 232.25, 229.44, 461.7, 263.88, 254.5, 495, 294, 275.58, 528.3, 320, 292.32,
      560, 320, 304.8, 593.3, 320, 313.06, 626.7, 320, 317.66, 660, 320, 319.65, 693.3, 320, 319.94, 725, 320,
      319.94,
    ],
  },
  up: {
    frames: [
      0, 0, 0, 33.3, 0, 0.09, 66.7, 0, 0.97, 100, 0, 3.06, 131.7, 0, 7.4, 165, 0, 13.7, 198.3, 11.88, 22.59,
      231.7, 29, 34.18, 265, 46, 47.88, 296.7, 62.67, 63.29, 330, 79.33, 79.54, 363.3, 97, 96.64, 396.7,
      113.75, 113.22, 430, 131, 128.88, 461.7, 147.88, 142.87, 495, 164, 154.84, 528.3, 180, 164.29, 561.7,
      180, 171.36, 595, 180, 176.06, 626.7, 180, 178.7, 660, 180, 179.87, 693.3, 180, 180, 726.7, 180, 180,
    ],
  },
  down: {
    frames: [
      0, 0, 0, 31.7, 0, 0.07, 65, 0, 0.92, 98.3, 0, 3.22, 131.7, 0, 7.4, 165, 0, 13.86, 196.7, 12.25, 23.08,
      230, 29, 34.42, 263.3, 46.25, 48.04, 296.7, 63, 63.27, 330, 80.25, 80.14, 361.7, 96.67, 96.79, 395,
      114.67, 113.51, 428.3, 131, 129.26, 461.7, 147.25, 143.17, 495, 165, 155.03, 526.7, 180, 164.47, 560,
      180, 171.5, 593.3, 180, 176.11, 626.7, 180, 178.76, 660, 180, 179.86, 691.7, 180, 180, 725, 180, 180,
    ],
  },
};

/*
 * PowerPoint's Wipe band itself: how much of the incoming slide it hides across the band (one slide long), from the
 * incoming slide's side, in 20 even parts, averaged over the four directions' frames with the whole band on the screen
 * (280-420 ms; each frame's own 10%-90% width carries the movie's noise, up to 2 px a side).
 */
const WIPE_BAND = [
  0, 0.0136, 0.035, 0.0745, 0.1188, 0.1757, 0.2404, 0.3093, 0.3847, 0.4622, 0.5388, 0.6166, 0.6902, 0.7635,
  0.8262, 0.8779, 0.9268, 0.9635, 0.988, 0.9999,
];

/** The `p%` stops of a mask `linear-gradient(to <side>, rgba(0, 0, 0, a) p%, …)` (as fractions), with its side. */
function maskStops(mask: string): { side: string; stops: [number, number][] } {
  const m = /^linear-gradient\(to (left|right|top|bottom), (.*)\)$/u.exec(mask);
  if (!m) throw new Error(`Not a wipe’s mask: ${mask}`);
  const stops = [...(m[2] ?? '').matchAll(/rgba\(0, 0, 0, ([\d.]+)\) (-?[\d.]+)%/gu)].map(
    (s): [number, number] => [Number(s[2]) / 100, Number(s[1])],
  );
  return { side: m[1] ?? '', stops };
}

/**
 * How much of the incoming slide each pixel along the wipe shows (4 samples a pixel, at `size` pixels), as
 * PowerPoint's movie was measured: its mask's alpha, inside its clip.
 */
function shownAlong(f: SlideFrame, direction: Direction, size: number): number[] {
  const horizontal = direction === 'left' || direction === 'right';
  const { side, stops } = f.mask ? maskStops(f.mask) : { side: '', stops: [] };
  const alpha = (x: number): number => {
    if (!side) return 1;
    const g = side === 'left' || side === 'top' ? 1 - x : x;
    let previous: [number, number] | null = null;
    for (const stop of stops) {
      if (g <= stop[0])
        return previous
          ? previous[1] + ((stop[1] - previous[1]) * (g - previous[0])) / (stop[0] - previous[0])
          : stop[1];
      previous = stop;
    }
    return previous ? previous[1] : 1;
  };
  // A clip: inset(top right bottom left), in %.
  const inset = (f.clip ?? 'inset(0 0 0 0)')
    .slice(6, -1)
    .trim()
    .split(/\s+/u)
    .map((v) => Number.parseFloat(v) / 100);
  const [top = 0, right = 0, bottom = 0, left = 0] =
    inset.length === 1 ? [inset[0], inset[0], inset[0], inset[0]] : inset;
  const [from, to] = horizontal ? [left, 1 - right] : [top, 1 - bottom];
  return Array.from({ length: size }, (_, i) => {
    let s = 0;
    for (let j = 0; j < 4; j++) {
      const x = (i + (j + 0.5) / 4) / size;
      s += x >= from && x <= to ? alpha(x) : 0;
    }
    return s / 4;
  });
}

/** Where a profile crosses `level`, in px from its start (sub-pixel, between pixel centres). */
function crossings(profile: readonly number[], level: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const a = (profile[i - 1] ?? 0) - level;
    const b = (profile[i] ?? 0) - level;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) out.push(i - 0.5 + a / (a - b));
  }
  return out;
}

describe('the slide a deck’s own Cover or Uncover moves is a little darker, as in PowerPoint’s own movie (13 Nov 2026)', () => {
  // The movie's colours (0-255): each slide at rest, and the slide that moves during the transition. Uncover's
  // outgoing from the transition's first frame, before it moves; Cover's incoming once it stops, until the end.
  const RED = [206, 43, 37];
  const BLUE = [35, 68, 202];
  const UNCOVER_MOVING = [203, 42, 36];
  const COVER_MOVING = [34, 68, 199];
  const shade = (f: SlideFrame) => Number(/^brightness\(([\d.]+)\)$/u.exec(f.filter ?? '')?.[1] ?? 1);

  it('drawn as PowerPoint’s within a level (0-255) while the transition runs, in every direction; the other slide as it is', () => {
    for (const direction of ['left', 'right', 'up', 'down'] as const)
      for (const p of [0.05, 0.3, 0.5, 0.8, 0.95]) {
        const cover = deckTransitionFrame(deckNative('cover', direction), p);
        const uncover = deckTransitionFrame(deckNative('uncover', direction), p);
        BLUE.forEach((c, i) => {
          expect(
            Math.abs(c * shade(cover.in) - (COVER_MOVING[i] ?? 0)),
            `cover ${direction}`,
          ).toBeLessThanOrEqual(1);
        });
        RED.forEach((c, i) => {
          expect(
            Math.abs(c * shade(uncover.out) - (UNCOVER_MOVING[i] ?? 0)),
            `uncover ${direction}`,
          ).toBeLessThanOrEqual(1);
        });
        expect(cover.out.filter ?? '').toBe('');
        expect(uncover.in.filter ?? '').toBe('');
      }
  });

  it('none before the transition starts or once it is over, and none on Push or Wipe', () => {
    for (const effect of ['cover', 'uncover', 'push', 'wipe'] as const)
      for (const p of [0, 1]) {
        const f = deckTransitionFrame(deckNative(effect, 'left'), p);
        expect([f.in.filter ?? '', f.out.filter ?? ''], `${effect} at ${String(p)}`).toEqual(['', '']);
      }
    for (const p of [0.25, 0.5, 0.75]) {
      for (const effect of ['push', 'wipe'] as const) {
        const f = deckTransitionFrame(deckNative(effect, 'up'), p);
        expect([f.in.filter ?? '', f.out.filter ?? ''], `${effect} at ${String(p)}`).toEqual(['', '']);
      }
    }
  });
});

describe('a deck’s own Wipe, against PowerPoint’s own movie (13 Nov 2026)', () => {
  it('the incoming slide shows through a soft band one slide long: its edge and how much shows within a pixel or two of PowerPoint’s every frame, every direction, the band’s form within 0.6%', () => {
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const size = direction === 'left' || direction === 'right' ? 320 : 180;
      // The incoming slide comes in from the right (left), the bottom (up), the left (right) or the top (down).
      const far = direction === 'left' || direction === 'up';
      const t = deckNative('wipe', direction);
      const at = (ms: number) => shownAlong(deckTransitionFrame(t, ms / 700).in, direction, size);
      const { frames } = WIPE[direction];
      for (let k = 0; k + 2 < frames.length; k += 3) {
        const [ms = 0, edge = 0, shown = 0] = frames.slice(k, k + 3);
        const profile = at(ms);
        const half = crossings(profile, 0.5);
        const ours =
          half.length === 0
            ? profile.reduce((a, b) => a + b, 0) > size / 2
              ? size
              : 0
            : far
              ? size - (half.at(-1) ?? 0)
              : (half[0] ?? 0);
        expect(Math.abs(ours - edge), `${direction} edge at ${String(ms)} ms`).toBeLessThanOrEqual(2);
        const sum = profile.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - shown), `${direction} shown at ${String(ms)} ms`).toBeLessThanOrEqual(1.5);
      }
      // The band's form: half-way through, the whole band is on the screen, from the incoming side to the far side.
      const whole = deckTransitionFrame(t, 0.5).in;
      expect(whole.mask, `${direction} mask`).toBeDefined();
      const { stops } = maskStops(whole.mask ?? '');
      WIPE_BAND.forEach((hidden, j) => {
        const u = (j + 0.5) / WIPE_BAND.length;
        const after = stops.findIndex(([g]) => g >= u);
        const [b, bShown] = stops[after] ?? [1, 0];
        const [a, aShown] = stops[after - 1] ?? [0, 1];
        const shown = b === a ? bShown : aShown + ((bShown - aShown) * (u - a)) / (b - a);
        expect(Math.abs(1 - shown - hidden), `${direction} band at ${u.toFixed(3)}`).toBeLessThanOrEqual(
          0.006,
        );
      });
    }
  });
});

describe('Drashti’s own transitions are not PowerPoint’s', () => {
  it('Drashti’s own Wipe is as it was: its pictures dissolve and its words’ hard diagonal edge crosses, with no mask or filter', () => {
    const size = { width: 1920, height: 1080 };
    expect(wordsFrame('wipe', 0.25, size)).toEqual({
      in: { opacity: 1, transform: '', clip: 'polygon(0 0, 133.5px 0, -168.9px 100%, 0 100%)' },
      out: { opacity: 1, transform: '', clip: 'polygon(133.5px 0, 100% 0, 100% 100%, -168.9px 100%)' },
    });
    expect(wordsFrame('wipe', 0.5, size)).toEqual({
      in: { opacity: 1, transform: '', clip: 'polygon(0 0, 1504.7px 0, 1202.3px 100%, 0 100%)' },
      out: { opacity: 1, transform: '', clip: 'polygon(1504.7px 0, 100% 0, 100% 100%, 1202.3px 100%)' },
    });
    expect(wordsFrame('wipe', 0.75, size)).toEqual({
      in: { opacity: 1, transform: '', clip: 'polygon(0 0, 2414.4px 0, 2112.0px 100%, 0 100%)' },
      out: { opacity: 1, transform: '', clip: 'polygon(2414.4px 0, 100% 0, 100% 100%, 2112.0px 100%)' },
    });
    expect(transitionFrame('wipe', 0.25, 'calm')).toEqual({
      in: { opacity: 0.15625, transform: '' },
      out: { opacity: 0.84375, transform: '' },
      black: 0,
      add: true,
    });
    expect(transitionFrame('slide', 0.25, 'bold')).toEqual({
      in: { opacity: 1, transform: 'translateX(87.5%)' },
      out: { opacity: 1, transform: 'translateX(-12.5%)' },
      black: 0,
      add: false,
    });
    // Nothing of a deck's own (a mask or a filter) on any of Drashti's own, at any point, on Calm or Bold screens.
    for (const kind of [
      'cut',
      'dissolve',
      'fade-black',
      'slide',
      'zoom',
      'wipe',
      'push',
      'zoom-dissolve',
      'lines',
      'words',
    ] as const)
      for (const movement of ['calm', 'bold'] as const)
        for (let i = 0; i <= 20; i++) {
          const f = transitionFrame(kind, i / 20, movement);
          expect([f.in.mask, f.out.mask, f.in.filter, f.out.filter], `${kind} ${movement}`).toEqual([
            undefined,
            undefined,
            undefined,
            undefined,
          ]);
        }
  });
});
