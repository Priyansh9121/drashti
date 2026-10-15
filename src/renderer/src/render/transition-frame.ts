import type { Movement } from '../../../shared/looks';
import type { Transition, TransitionKind } from '../../../shared/model';
import { SLOW_ZOOM_MS, SLOW_ZOOM_SCALE } from '../../../shared/model';
import { EASE } from './easing';

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
 */

export interface SlideFrame {
  opacity: number;
  /** A CSS transform ('' for none). */
  transform: string;
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
