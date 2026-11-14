import { describe, expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { EASE } from './easing';
import {
  deckSlideClip,
  deckTransitionFrame,
  dissolveCurve,
  easeInOut,
  deckWipeShows,
  type SlideFrame,
  takesTime,
  transitionFrame,
  wordsFrame,
  wipeBandStyles,
  wipeSlideMask,
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
  it('the slide that moves (Cover’s incoming, Uncover’s outgoing) is where PowerPoint’s is, within a pixel and a quarter at 320 x 180, every frame, every direction', () => {
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

describe('a deck’s own Wipe, PowerPoint’s soft band (Session 58, C2)', () => {
  /** PowerPoint's band (h-p3tr, 13 Nov 2026): whole up to its start, a half cosine one slide long, nothing past it. */
  const halfCosine = (p: number, at: number) => {
    if (p >= 1) return 1;
    const u = at - (2 * p - 1);
    return u <= 0 ? 1 : u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u);
  };

  it('shows the incoming slide through a band one slide long, a half cosine across, moving evenly from its own side: within 0.002 everywhere, every direction', () => {
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const t = deckNative('wipe', direction);
      for (let i = 0; i <= 28; i++)
        for (let k = 0; k <= 64; k++) {
          const p = i / 28;
          const at = k / 64;
          expect(
            Math.abs(deckWipeShows(t, p, at) - halfCosine(p, at)),
            `${direction} at ${String(p)}, ${String(at)} across`,
          ).toBeLessThanOrEqual(0.002);
        }
      // Before it starts nothing of it shows; once over, all of it.
      expect(deckWipeShows(t, 0, 0.001)).toBe(0);
      expect(deckWipeShows(t, 1, 0.999)).toBe(1);
    }
  });

  it('its middle is where PowerPoint’s movie has it, within a pixel at 320 across, every frame (h-p3tr’s fit: -160.7 + 640.05 t / 700 px)', () => {
    const t = deckNative('wipe', 'left');
    // Every frame while it runs (at 700 ms it is over: all of the slide shows).
    for (let frame = 0; frame < 21; frame++) {
      const ms = (frame * 700) / 21;
      const fit = -160.7 + (640.05 * ms) / 700;
      // Where the band shows half the slide, from the incoming side, in px at 320 (the band's middle).
      let lo = -1;
      let hi = 2;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        if (deckWipeShows(t, ms / 700, mid) > 0.5) lo = mid;
        else hi = mid;
      }
      expect(Math.abs(lo * 320 - fit), `at ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(1);
    }
  });

  it('is a band on the incoming slide only while it runs: no clip, no mask on the slide, the outgoing slide as it is', () => {
    for (const direction of ['left', 'right', 'up', 'down'] as const)
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const f = deckTransitionFrame(deckNative('wipe', direction), p);
        expect(f.in, `${direction} at ${String(p)}`).toEqual(
          p >= 1
            ? { opacity: 1, transform: '' }
            : { opacity: 1, transform: '', band: { direction, at: 2 * p - 1 } },
        );
        expect(f.out, `${direction} at ${String(p)}`).toEqual({ opacity: 1, transform: '' });
      }
  });

  /** A length in a band's style, in px ('0', '12px' or '-12.5px'). */
  const lengthOf = (value: string): number => {
    if (value === '0') return 0;
    const m = /^(-?[\d.e+-]+)px$/u.exec(value);
    if (!m) throw new Error(`not a length in px: ${value}`);
    return Number(m[1]);
  };
  /** A translateX or translateY in px. */
  const moveOf = (transform: string): { axis: 'X' | 'Y'; px: number } => {
    const m = /^translate([XY])\((-?[\d.e+-]+)px\)$/u.exec(transform);
    if (!m) throw new Error(`not a move: ${transform}`);
    return { axis: m[1] as 'X' | 'Y', px: Number(m[2]) };
  };
  /** A linear gradient's alpha at `t` (0 to 1 along it), straight between its stops. */
  const alphaAt = (gradient: string, t: number): number => {
    const stops = [...gradient.matchAll(/rgba\(0, 0, 0, ([\d.]+)\) (-?[\d.]+)%/gu)].map((m) => ({
      a: Number(m[1]),
      at: Number(m[2]) / 100,
    }));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) throw new Error(`no stops: ${gradient}`);
    if (t <= first.at) return first.a;
    if (t >= last.at) return last.a;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      if (a && b && t <= b.at) return b.at === a.at ? b.a : a.a + ((b.a - a.a) * (t - a.at)) / (b.at - a.at);
    }
    return last.a;
  };
  /** Screens and the slide's place on each (the layer's box, as Placed puts the slide in it). */
  const PLACES = [
    {
      what: 'a 16:9 slide filling a 16:9 screen',
      canvas: { width: 1920, height: 1080 },
      slide: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      what: 'a 4:3 slide fitted to a 16:9 screen',
      canvas: { width: 1920, height: 1080 },
      slide: { x: 240, y: 0, width: 1440, height: 1080 },
    },
    {
      what: 'a 4:3 slide filling a 16:9 screen',
      canvas: { width: 1920, height: 1080 },
      slide: { x: 0, y: -180, width: 1920, height: 1440 },
    },
    {
      what: 'a 16:9 slide fitted to a 4:3 box',
      canvas: { width: 1440, height: 1080 },
      slide: { x: 0, y: 135, width: 1440, height: 810 },
    },
  ] as const;

  it('is drawn as a mask that never changes on a box two slides long, moved by whole device pixels, the slide moved back inside it: what shows is the band, one slide long wherever the slide is placed', () => {
    for (const { what, canvas, slide } of PLACES)
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const across = direction === 'left' || direction === 'right';
        const masks = new Set<string>();
        for (const dpr of [1, 1.25, 2])
          for (let i = 1; i < 20; i++) {
            const p = i / 20 + 0.0123;
            const t = deckNative('wipe', direction);
            const band = deckTransitionFrame(t, p).in.band;
            const where = `${what}, ${direction}, dpr ${String(dpr)} at ${String(p)}`;
            expect(band, where).toBeDefined();
            if (!band) continue;
            const s = wipeBandStyles(band, slide, canvas, dpr);
            masks.add(s.holder.maskImage);
            const holderMove = moveOf(s.holder.transform);
            const slideMove = moveOf(s.slide.transform);
            expect(holderMove.axis, where).toBe(across ? 'X' : 'Y');
            // Whole device pixels, and the slide moved back by exactly as much.
            expect(Math.abs(holderMove.px * dpr - Math.round(holderMove.px * dpr)), where).toBeLessThan(1e-9);
            expect(slideMove.px, where).toBe(-holderMove.px);
            // The box: two slides long along the band, the whole screen across it; the slide's box inside it the
            // screen's own, where the screen's is.
            const [top = '', right = '', bottom = '', left = ''] = s.holder.inset.split(' ');
            expect([across ? top : left, across ? bottom : right], where).toEqual(['0', '0']);
            expect(across ? right : bottom, where).toBe('auto');
            const start = lengthOf(across ? left : top);
            const length = lengthOf(across ? s.holder.width : s.holder.height);
            const slideLength = across ? slide.width : slide.height;
            expect(Math.abs(length - 2 * slideLength), where).toBeLessThanOrEqual(1 / dpr);
            const [sTop = '', sRight = '', sBottom = '', sLeft = ''] = s.slide.inset.split(' ');
            expect([across ? sTop : sLeft, across ? sBottom : sRight], where).toEqual(['0', '0']);
            const inside = lengthOf(across ? sLeft : sTop);
            expect(lengthOf(across ? s.slide.width : s.slide.height), where).toBe(
              across ? canvas.width : canvas.height,
            );
            // The slide stays exactly where it is.
            expect(Math.abs(start + holderMove.px + inside + slideMove.px), where).toBeLessThan(1e-9);
            // What shows at each point of the slide is the band's, the slide's own length long.
            const toward = /^linear-gradient\(to (left|right|top|bottom), /u.exec(s.holder.maskImage)?.[1];
            const slideStart = across ? slide.x : slide.y;
            for (let k = 0; k <= 48; k++) {
              const x = slideStart + (k / 48) * slideLength;
              const inBox = (x - (start + holderMove.px)) / length;
              const along = toward === 'right' || toward === 'bottom' ? inBox : 1 - inBox;
              const at = direction === 'left' || direction === 'up' ? 1 - k / 48 : k / 48;
              expect(
                Math.abs(alphaAt(s.holder.maskImage, along) - deckWipeShows(t, p, at)),
                `${where}, ${at.toFixed(3)} across`,
              ).toBeLessThanOrEqual(0.003);
            }
          }
        // One mask the whole Wipe long, whatever the screen.
        expect(masks.size, `${what}, ${direction}`).toBe(1);
      }
  });
});

describe('a deck’s own Wipe where the page draws with a graphics chip: the band as a mask on the slide’s box (Session 58)', () => {
  /** A linear gradient's alpha `d` px along it, straight between its stops (in px). */
  const alphaAtPx = (gradient: string, d: number): number => {
    const stops = [...gradient.matchAll(/rgba\(0, 0, 0, ([\d.]+)\) (-?[\d.]+)px/gu)].map((m) => ({
      a: Number(m[1]),
      at: Number(m[2]),
    }));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) throw new Error(`no stops: ${gradient}`);
    if (d <= first.at) return first.a;
    if (d >= last.at) return last.a;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      if (a && b && d <= b.at) return b.at === a.at ? b.a : a.a + ((b.a - a.a) * (d - a.at)) / (b.at - a.at);
    }
    return last.a;
  };
  const PLACES = [
    { canvas: { width: 1920, height: 1080 }, slide: { x: 0, y: 0, width: 1920, height: 1080 } },
    { canvas: { width: 1920, height: 1080 }, slide: { x: 240, y: 0, width: 1440, height: 1080 } },
    { canvas: { width: 1920, height: 1080 }, slide: { x: 0, y: -180, width: 1920, height: 1440 } },
    { canvas: { width: 1440, height: 1080 }, slide: { x: 0, y: 135, width: 1440, height: 810 } },
  ] as const;

  it('what shows at each point of the slide is the band, one slide long wherever the slide is placed, the gradient running across the whole layer from the incoming side', () => {
    for (const { canvas, slide } of PLACES)
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const across = direction === 'left' || direction === 'right';
        const fromEnd = direction === 'left' || direction === 'up';
        const length = across ? slide.width : slide.height;
        const start = across ? slide.x : slide.y;
        const screen = across ? canvas.width : canvas.height;
        const t = deckNative('wipe', direction);
        for (let i = 1; i < 20; i++) {
          const p = i / 20 + 0.0123;
          const band = deckTransitionFrame(t, p).in.band;
          if (!band) throw new Error('no band');
          const mask = wipeSlideMask(band, slide, canvas);
          expect(mask, direction).toMatch(
            new RegExp(
              `^linear-gradient\\(to ${{ left: 'left', right: 'right', up: 'top', down: 'bottom' }[direction]}, `,
              'u',
            ),
          );
          for (let k = 0; k <= 48; k++) {
            const x = start + (k / 48) * length;
            // Along the gradient: from the layer's edge on the incoming side.
            const d = fromEnd ? screen - x : x;
            const at = fromEnd ? 1 - k / 48 : k / 48;
            expect(
              Math.abs(alphaAtPx(mask, d) - deckWipeShows(t, p, at)),
              `${direction} on ${JSON.stringify(slide)} at ${String(p)}, ${at.toFixed(3)} across`,
            ).toBeLessThanOrEqual(0.002);
          }
        }
      }
  });
});

describe('a deck’s own Push, Cover and Uncover on the slide where it is placed (Session 58, Q58-16)', () => {
  const SCREEN = { width: 1920, height: 1080 };
  const FULL = { x: 0, y: 0, width: 1920, height: 1080 };
  /** A 4:3 slide fitted to a 16:9 screen: bars either side. */
  const BARS = { x: 240, y: 0, width: 1440, height: 1080 };
  /** A move in px ('' for none). */
  const pxOf = (transform: string): number => {
    if (transform === '') return 0;
    const m = /^translate[XY]\((-?[\d.e+-]+)px\)$/u.exec(transform);
    if (!m) throw new Error(`not a move in px: ${transform}`);
    return Number(m[1]);
  };

  it('a 4:3 slide fitted to a 16:9 screen moves by its own width (or height) in px, as PowerPoint moves it, its shade and order as before', () => {
    for (const effect of ['push', 'cover', 'uncover'] as const)
      for (const direction of ['left', 'right', 'up', 'down'] as const) {
        const length = direction === 'left' || direction === 'right' ? BARS.width : BARS.height;
        const t = deckNative(effect, direction);
        for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const onScreen = deckTransitionFrame(t, p);
          const onSlide = deckTransitionFrame(t, p, 'calm', { in: BARS, out: BARS });
          for (const side of ['in', 'out'] as const) {
            // The screen's move, in % of the layer's box, is the slide's in px of the slide's own length.
            const want = (shiftOf(onScreen[side], 100) / 100) * length;
            expect(
              Math.abs(pxOf(onSlide[side].transform) - want),
              `${effect} ${direction} ${side} at ${String(p)}`,
            ).toBeLessThan(1e-6);
            expect(onSlide[side].filter, `${effect} ${direction} ${side}`).toBe(onScreen[side].filter);
          }
        }
      }
  });

  it('both slides are clipped to the slide where the screen shows past it (the bars stay black); not where the slide fills or crops the screen, nor for the other effects', () => {
    for (const effect of ['push', 'cover', 'uncover'] as const) {
      const t = deckNative(effect, 'left');
      expect(deckSlideClip(t, BARS, BARS, SCREEN), effect).toBe('inset(0px 240px 0px 240px)');
      // A 16:9 slide fitted to a 4:3 box: bars above and below.
      expect(
        deckSlideClip(
          t,
          { x: 0, y: 135, width: 1440, height: 810 },
          { x: 0, y: 135, width: 1440, height: 810 },
          {
            width: 1440,
            height: 1080,
          },
        ),
        effect,
      ).toBe('inset(135px 0px 135px 0px)');
      expect(deckSlideClip(t, FULL, FULL, SCREEN), effect).toBe('');
      // Cropped to fill: the screen's own edge is the slide's.
      const cropped = { x: 0, y: -180, width: 1920, height: 1440 };
      expect(deckSlideClip(t, cropped, cropped, SCREEN), effect).toBe('');
      // A slide of another size going (a 16:9 one before a 4:3 deck): round both, so neither is cut.
      expect(deckSlideClip(t, BARS, FULL, SCREEN), effect).toBe('');
    }
    for (const effect of ['wipe', 'dissolve', 'fade-black', 'zoom'] as const)
      expect(deckSlideClip(deckNative(effect, 'left'), BARS, BARS, SCREEN), effect).toBe('');
    // Whole pixels (review LOW-2): a third of a pixel short of the screen is no clip; a part-pixel bar rounds.
    const t = deckNative('push', 'left');
    const near = { x: 0.33333, y: 0, width: 1365.33333, height: 768 };
    expect(deckSlideClip(t, near, near, { width: 1366, height: 768 })).toBe('');
    const part = { x: 240.4, y: 0, width: 1439.2, height: 1080 };
    expect(deckSlideClip(t, part, part, SCREEN)).toBe('inset(0px 240px 0px 240px)');
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
          expect(
            [f.in.mask, f.out.mask, f.in.filter, f.out.filter, f.in.band, f.out.band],
            `${kind} ${movement}`,
          ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
        }
  });
});
