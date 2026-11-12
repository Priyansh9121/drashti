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

describe('a deck’s own Wipe (Q57-28, 13 Nov 2026)', () => {
  it('the incoming slide shows up to a hard edge moving evenly from its own side, as before PowerPoint’s soft band: a clip, no mask', () => {
    const clips: Record<Direction, (edge: string) => string> = {
      left: (edge) => `inset(0 0 0 ${edge})`,
      right: (edge) => `inset(0 ${edge} 0 0)`,
      up: (edge) => `inset(${edge} 0 0 0)`,
      down: (edge) => `inset(0 0 ${edge} 0)`,
    };
    for (const direction of ['left', 'right', 'up', 'down'] as const)
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const f = deckTransitionFrame(deckNative('wipe', direction), p);
        expect(f.in, `${direction} at ${String(p)}`).toEqual({
          opacity: 1,
          transform: '',
          clip: clips[direction](`${String((1 - p) * 100)}%`),
        });
        expect(f.in.mask, `${direction} at ${String(p)}`).toBeUndefined();
        expect(f.out, `${direction} at ${String(p)}`).toEqual({ opacity: 1, transform: '' });
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
