import type { Movement } from '../../../shared/looks';
import type { Transition, TransitionKind } from '../../../shared/model';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { EASE, lerp } from './easing';

/*
 * How a transition draws its two slides at a point in it (Session 26d), as
 * a pure function of how far it is, so every screen, timed from the
 * engine's shownAt, draws exactly the same: the slide coming on (`in`), the
 * slide going off (`out`), and black over both.
 *
 * - Fade (a dissolve): the old slide out and the new one in, the new one
 *   added light for light over the old, so where both are the same the
 *   picture never dips. Eased since Session 27, the design lab's way: Calm
 *   on smoothstep, Bold on its own ease in and out; either way in + out = 1
 *   at every point, and the background dissolves on the same curve.
 * - Fade through black: black comes over the old slide until it is whole
 *   half-way, then goes from over the new one.
 * - Slide: the new slide comes in from the right as the old one goes out
 *   to the left, easing in and out.
 * - Slow zoom: a fade, and each slide zooms in slowly while it is up
 *   (zoomAt), from when it went up.
 *
 * Bold moves (Session 27, the design lab's decision 16): pushes and zooms
 * move only the words. While one runs, each slide's words are drawn apart,
 * in a layer of their own above both slides' pictures, shapes and colour,
 * which only dissolve (so a darshan picture stays whole); once it is over,
 * the slide is drawn exactly as designed. wordsMove says when, wordsFrame
 * how.
 */

export interface SlideFrame {
  opacity: number;
  /** A CSS transform ('' for none). */
  transform: string;
}

/** A part of a slide while a move runs (its words): its opacity, transform and clip ('' for none). */
export interface PartFrame {
  opacity: number;
  transform: string;
  /** A CSS clip-path ('' for none). */
  clip: string;
}

export interface TransitionFrame {
  in: SlideFrame;
  out: SlideFrame;
  /** Black over both slides, 0 to 1. */
  black: number;
  /** The new slide is added light for light over the old (plus-lighter). */
  add: boolean;
}

const clamp = (p: number) => Math.min(1, Math.max(0, p));

/** Easing in and out (the slide), symmetrical: half-way is half-way. */
export const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** A Movement's dissolve curve (Session 27): how far in the new slide is at `p`; the old is out by as much. */
export const dissolveCurve = (movement: Movement): ((p: number) => number) =>
  movement === 'bold' ? EASE.inOut : EASE.smooth;

/** The two slides and the black at `p` (0 to 1) of a transition of `kind`, on screens that move `movement`. */
export function transitionFrame(
  kind: TransitionKind,
  p: number,
  movement: Movement = 'calm',
): TransitionFrame {
  const q = clamp(p);
  switch (kind) {
    case 'fade-black':
      return {
        in: { opacity: q < 0.5 ? 0 : 1, transform: '' },
        out: { opacity: q < 0.5 ? 1 : 0, transform: '' },
        black: 1 - Math.abs(2 * q - 1),
        add: false,
      };
    case 'slide': {
      const e = easeInOut(q);
      return {
        in: { opacity: 1, transform: e >= 1 ? '' : `translateX(${String((1 - e) * 100)}%)` },
        out: { opacity: 1, transform: `translateX(${String(-e * 100)}%)` },
        black: 0,
        add: false,
      };
    }
    // The design lab's moves (Session 27) move only the words, apart (wordsFrame): the slides' pictures,
    // shapes and colour dissolve, as in a fade.
    case 'wipe':
    case 'push':
    case 'zoom-dissolve':
    case 'lines':
    case 'words':
    case 'dissolve':
    case 'zoom': {
      const e = dissolveCurve(movement)(q);
      return {
        in: { opacity: e, transform: '' },
        out: { opacity: 1 - e, transform: '' },
        black: 0,
        add: true,
      };
    }
    case 'cut':
      return { in: { opacity: 1, transform: '' }, out: { opacity: 0, transform: '' }, black: 0, add: false };
  }
}

/** Whether a transition takes time (a cut, or anything of no length, does not). */
export const takesTime = (t: Transition | undefined): t is Transition =>
  t !== undefined && t.kind !== 'cut' && t.durationMs > 0;

/** How long a slow zoom zooms in for. */
export const zoomSpan = (t: Transition): number =>
  t.spanMs !== undefined && t.spanMs > 0 ? t.spanMs : SLOW_ZOOM_MS;

/**
 * A slide's size at `now`, for a slide that came on at `shownAt` by `t`: 1, or for a slow zoom from 1 to
 * SLOW_ZOOM_SCALE over its span, held there after.
 */
export function zoomAt(t: Transition | undefined, shownAt: number, now: number): number {
  if (t?.kind !== 'zoom') return 1;
  return 1 + (SLOW_ZOOM_SCALE - 1) * clamp((now - shownAt) / zoomSpan(t));
}

/** How the words move apart from the slide's pictures while a transition runs (Session 27). */
export type WordsMove = 'settle' | 'wipe' | 'push' | 'zoom' | 'lines' | 'words';

/**
 * Whether a transition draws the words apart from the pictures, and how. Bold: its dissolve lets the new
 * words settle as they come in; the wipe, the push and the zoom move them. Both Movements: the words line by
 * line, or word by word, except on a kirtan's slides (never word by word there, whatever the Look: its
 * dissolve instead). Null: the slides are drawn whole (every cut, Calm dissolve and Repeat Slides' own kind,
 * and the Bold kinds on Calm screens, which fade).
 */
export function wordsMove(kind: TransitionKind, movement: Movement, kirtan = false): WordsMove | null {
  const bold = movement === 'bold';
  switch (kind) {
    case 'lines':
      return 'lines';
    case 'words':
      return kirtan ? (bold ? 'settle' : null) : 'words';
    case 'dissolve':
      return bold ? 'settle' : null;
    case 'wipe':
      return bold ? 'wipe' : null;
    case 'push':
      return bold ? 'push' : null;
    case 'zoom-dissolve':
      return bold ? 'zoom' : null;
    case 'cut':
    case 'fade-black':
    case 'slide':
    case 'zoom':
      return null;
  }
}

/**
 * The two slides' words, drawn apart above their pictures, at `p` (0 to 1) of a move, on a canvas of `size`
 * (the wipe's slant is the lab's, a quarter of the height). Line by line and word by word draw each line or
 * word on its own (reveal.ts): their layers are whole here.
 */
export function wordsFrame(
  move: WordsMove,
  p: number,
  size: { width: number; height: number } = { width: 1920, height: 1080 },
): { in: PartFrame; out: PartFrame } {
  const q = clamp(p);
  const whole: PartFrame = { opacity: 1, transform: '', clip: '' };
  switch (move) {
    case 'settle': {
      // Bold's dissolve (the lab's): the new words come in on the same curve as the pictures, settling from
      // 103% to their own size; the old ones go as the pictures do. In + out = 1.
      const e = EASE.inOut(q);
      return {
        in: { opacity: e, transform: e >= 1 ? '' : `scale(${String(lerp(1.03, 1, e))})`, clip: '' },
        out: { opacity: 1 - e, transform: '', clip: '' },
      };
    }
    case 'wipe': {
      // A hard diagonal edge (15 degrees) crossing from the left: the new words before it, the old after.
      const e = EASE.wipe(q);
      const slant = 0.28 * size.height;
      const x = lerp(-slant, size.width + slant, e);
      const px = (v: number) => `${v.toFixed(1)}px`;
      return {
        in: {
          opacity: 1,
          transform: '',
          clip: e >= 1 ? '' : `polygon(0 0, ${px(x + slant)} 0, ${px(x)} 100%, 0 100%)`,
        },
        out: {
          opacity: 1,
          transform: '',
          clip: `polygon(${px(x + slant)} 0, 100% 0, 100% 100%, ${px(x)} 100%)`,
        },
      };
    }
    case 'push': {
      // The old words out to the left as the new come in from the right, the screen's width.
      const e = EASE.inOut(q);
      return {
        in: { opacity: 1, transform: e >= 1 ? '' : `translateX(${String((1 - e) * 100)}%)`, clip: '' },
        out: { opacity: 1, transform: `translateX(${String(-e * 100)}%)`, clip: '' },
      };
    }
    case 'zoom': {
      // The old words grow to 108% as they go; the new grow from 92% to their own size as they come.
      const e = EASE.inOut(q);
      return {
        in: { opacity: e, transform: e >= 1 ? '' : `scale(${String(lerp(0.92, 1, e))})`, clip: '' },
        out: { opacity: 1 - e, transform: `scale(${String(lerp(1, 1.08, e))})`, clip: '' },
      };
    }
    case 'lines':
    case 'words':
      return { in: whole, out: whole };
  }
}
