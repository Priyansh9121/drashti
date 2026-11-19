import type { DeckNativeTransition } from '../../../shared/deck-transition';
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
  /** A wipe's clip on the whole slide. */
  clip?: string;
  /**
   * A deck's own transition only: a CSS mask-image on the whole slide. None draws one now: PowerPoint's Wipe band was
   * one, until it dropped frames on Windows while streaming (Q57-28, 13 Nov 2026); it is `band` since Session 58.
   */
  mask?: string;
  /** A deck's own transition only: a CSS filter on the whole slide (the slide PowerPoint's Cover or Uncover moves). */
  filter?: string;
  /**
   * A deck's own Wipe only (Session 58): PowerPoint's soft band over the slide, drawn as a mask on the incoming slide's
   * box by wipeSlideMask (render/SlideLayerView.tsx), with a graphics chip and without (X11).
   */
  band?: WipeBand;
  /**
   * A deck's own Push, Cover or Uncover only, its own transition alone (X11): how far the slide is moved, the same move
   * as `transform` as a number, so a page without a graphics chip can move it on a layer of its own in whole device
   * pixels (render/SlideLayerView.tsx). None where the slide does not move.
   */
  shift?: SlideShift;
}

/**
 * How far a deck's own Push, Cover or Uncover moves a slide (X11), along `axis`: `by` px of the slide where it is placed
 * (`of` 'px'), or `by` of the layer's box, the slide's own box, where it fills it (`of` 'box', the transform's % / 100).
 */
export interface SlideShift {
  axis: 'x' | 'y';
  of: 'px' | 'box';
  by: number;
}

/** The way a deck's own Wipe goes: 'left' comes in from the right, 'up' from the bottom (as its clip did before). */
type WipeDirection = NonNullable<DeckNativeTransition['direction']>;

/** A deck's own Wipe part-way (Session 58): where PowerPoint's soft band is over the incoming slide. */
export interface WipeBand {
  direction: WipeDirection;
  /**
   * Where the band starts, in slides from the incoming slide's own side: -1 (none of it shows) to 1 (all of it). The
   * slide shows whole up to there, through the band one slide long past it (deckWipeShows), not at all beyond.
   */
  at: number;
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

/**
 * The original PowerPoint effect draws entire slides, even on Calm screens. Given where each slide is in the layer's box
 * (`places`, as Placed puts them), a slide that moves moves by its own width or height in px, as PowerPoint moves it
 * (Session 58, Q58-16: a 4:3 deck between bars on a 16:9 screen moves 1440 px, not the screen's 1920); without them, by
 * the layer's box in % (the PowerPoint comparison's probe draws the slide alone, where both are the same).
 */
export function deckTransitionFrame(
  transition: DeckNativeTransition,
  progress: number,
  movement: Movement = 'calm',
  places?: { in: SlidePlace; out: SlidePlace },
): TransitionFrame {
  const elapsed = clamp(progress) * transition.durationMs;
  const original = powerPointFrame(
    transition,
    elapsed / (transition.deckDurationMs ?? transition.durationMs),
    places,
  );
  const over = transition.over;
  if (!over || over.durationMs <= 0) return original;
  const outer = transitionFrame(over.kind, elapsed / over.durationMs, movement);
  const transform = (a: SlideFrame, b: SlideFrame) => [a.transform, b.transform].filter(Boolean).join(' ');
  // Moved as Drashti's own transition moves the whole layer too: no move of the deck's own alone (X11's shift).
  const alone = ({ shift: _shift, ...rest }: SlideFrame): SlideFrame => rest;
  return {
    in: {
      ...alone(original.in),
      opacity: original.in.opacity * outer.in.opacity,
      transform: transform(outer.in, original.in),
    },
    out: {
      ...alone(original.out),
      opacity: clamp(outer.out.opacity + original.out.opacity * outer.in.opacity),
      transform: transform(outer.out, original.out),
    },
    black: Math.max(original.black * outer.in.opacity, outer.black),
    add: original.add && outer.add,
  };
}

function powerPointFrame(
  transition: DeckNativeTransition,
  progress: number,
  places?: { in: SlidePlace; out: SlidePlace },
): TransitionFrame {
  const p = clamp(progress);
  const settled: SlideFrame = { opacity: 1, transform: '' };
  const direction = transition.direction ?? 'left';
  const horizontal = direction === 'left' || direction === 'right';
  const toward = direction === 'left' || direction === 'up' ? -1 : 1;
  // A slide's move, `fraction` of its own length along the way: in px of the slide where it is placed, else in %.
  const along = (place: SlidePlace | undefined) =>
    place ? (horizontal ? place.width : place.height) : undefined;
  // A slide's move, `fraction` of its own length along the way, as a transform and as a number (X11): in px of the
  // slide where it is placed, else as a share of the layer's box (the transform's %). None for no move.
  const moveBy = (fraction: number, length: number | undefined): Pick<SlideFrame, 'transform' | 'shift'> => {
    if (fraction === 0) return { transform: '' };
    const shift: SlideShift =
      length === undefined
        ? { axis: horizontal ? 'x' : 'y', of: 'box', by: fraction * toward }
        : { axis: horizontal ? 'x' : 'y', of: 'px', by: fraction * toward * length };
    const amount = shift.of === 'box' ? `${String(shift.by * 100)}%` : `${String(shift.by)}px`;
    return { transform: `translate${horizontal ? 'X' : 'Y'}(${amount})`, shift };
  };
  const shiftIn = (fraction: number) => moveBy(fraction, along(places?.in));
  const shift = (fraction: number) => moveBy(fraction, along(places?.out));
  switch (transition.deckEffect) {
    case 'push': {
      const e = easeInOut(p);
      return {
        in: { ...settled, ...shiftIn(e - 1) },
        out: { ...settled, ...shift(e) },
        black: 0,
        add: false,
      };
    }
    case 'cover':
    case 'uncover': {
      // PowerPoint's own curve, and the slide it moves a little darker while the transition runs.
      const e = SLIDE_CURVES[transition.deckEffect][horizontal ? 'across' : 'down'](p);
      const moving: SlideFrame = { ...settled, ...(p > 0 && p < 1 ? { filter: MOVING_SHADE } : {}) };
      return transition.deckEffect === 'cover'
        ? { in: { ...moving, ...shiftIn(e - 1) }, out: settled, black: 0, add: false }
        : { in: settled, out: { ...moving, ...shift(e) }, black: 0, add: false };
    }
    case 'wipe':
      // PowerPoint's soft band (Session 58), its start moving evenly from a slide outside the incoming slide's own side
      // to its far side: drawn by wipeSlideMask, below.
      return {
        in: p >= 1 ? settled : { ...settled, band: { direction, at: 2 * p - 1 } },
        out: settled,
        black: 0,
        add: false,
      };
    case 'zoom': {
      const e = easeInOut(p);
      return {
        in: { opacity: e, transform: e === 1 ? '' : `scale(${String(0.5 + e * 0.5)})` },
        out: settled,
        black: 0,
        add: false,
      };
    }
    case 'fade-black':
    case 'dissolve':
      return transitionFrame(transition.deckEffect, p);
  }
}

/*
 * A deck's own Wipe as PowerPoint's own movie draws it (h-p3tr, 13 Nov 2026: measured frame by frame at 320 x 180):
 * the incoming slide shows through a soft band one slide long, its middle moving at an even speed from half a slide
 * outside the incoming slide's own side (nothing shows) to half a slide past the far side (all of it shows). Across the
 * band it fades as a half cosine (the movie's band, averaged, is within 0.3% of one), drawn as WIPE_STEPS + 1 stops
 * with straight lines between them (within 0.15% of the cosine).
 *
 * Drawn as a mask on the incoming slide's box, its stops moved each frame (wipeSlideMask), with a graphics chip and
 * without. Without one (X11, on CI's two-core Windows while streaming) that is the cheapest way found: the slide and
 * its mask are drawn again each frame on the raster threads, the outgoing slide a still layer of its own (so it is
 * not drawn again with it: render/SlideLayerView.tsx); Session 58's other way (C2: the band's mask that never changed
 * on a box two slides long, moved, the slide moved back inside it) left every frame to the compositor's one thread
 * for every window (776 ms of it in 900 ms) and dropped 43-51 of ~95 frames, against 12-17 of ~155 this way
 * (h-x11-windows-7, -8).
 */

/** The steps of the Wipe band's gradient. */
const WIPE_STEPS = 20;

/** How much of the incoming slide shows at each step across the Wipe band, from its own side (1) to the far end (0). */
const WIPE_BAND = Array.from({ length: WIPE_STEPS + 1 }, (_, j) =>
  Number((0.5 + 0.5 * Math.cos((Math.PI * j) / WIPE_STEPS)).toFixed(4)),
);

/** From the incoming slide's own side toward the far side, as a CSS gradient's way. */
const WIPE_TOWARD: Readonly<Record<WipeDirection, string>> = {
  left: 'to left',
  right: 'to right',
  up: 'to top',
  down: 'to bottom',
};

/** How much of the incoming slide `band` shows `at` across (0 at its own side, 1 at the far side), as its mask draws it. */
function bandShows(band: WipeBand | undefined, at: number): number {
  if (!band) return 1;
  const u = (at - band.at) * WIPE_STEPS;
  if (u <= 0) return 1;
  if (u >= WIPE_STEPS) return 0;
  const j = Math.floor(u);
  const from = WIPE_BAND[j] ?? 0;
  return from + ((WIPE_BAND[j + 1] ?? 0) - from) * (u - j);
}

/**
 * How much of the incoming slide a deck's own transition shows at `progress` (0 to 1), `at` across from the slide's own
 * side (0) to the far side (1), as every screen draws it: 0 to 1, PowerPoint's band while a Wipe runs, else all of it.
 * For the PowerPoint comparison's probe (h-pptx3) and the tests.
 */
export function deckWipeShows(transition: DeckNativeTransition, progress: number, at: number): number {
  return bandShows(deckTransitionFrame(transition, progress).in.band, at);
}

/** Where a slide is in its layer's box, in CSS px (as Placed puts it: render/Placed.tsx, shared/scaling.ts). */
export interface SlidePlace {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The band as a mask on the incoming slide's own box (the layer's), with a graphics chip and without (render/chipless.ts):
 * a new mask each frame, its stops moved. The gradient runs across the whole layer from the edge on the incoming side,
 * its stops in px: the band one slide long on the slide where it is placed (a 4:3 deck between bars on a 16:9 screen,
 * cropped to fill it, or in a picture-in-picture box), whole before it, nothing past it.
 */
export function wipeSlideMask(
  band: WipeBand,
  slide: SlidePlace,
  canvas: { width: number; height: number },
): string {
  const { direction } = band;
  const across = direction === 'left' || direction === 'right';
  const fromEnd = direction === 'left' || direction === 'up';
  const length = across ? slide.width : slide.height;
  const slideStart = across ? slide.x : slide.y;
  const screen = across ? canvas.width : canvas.height;
  // How far the slide's own incoming side is from the layer's edge the gradient starts at.
  const side = fromEnd ? screen - (slideStart + length) : slideStart;
  const stops = WIPE_BAND.map(
    (shown, j) =>
      `rgba(0, 0, 0, ${String(shown)}) ${(side + (band.at + j / WIPE_STEPS) * length).toFixed(2)}px`,
  );
  return `linear-gradient(${WIPE_TOWARD[direction]}, ${stops.join(', ')})`;
}

/**
 * The clip on the slide layer while a deck's own Push, Cover or Uncover moves a slide (Session 58, Q58-16): PowerPoint
 * moves its slides inside the slide, so where the screen shows past the slide (a 4:3 deck between bars on a 16:9
 * screen) both are clipped to it and the bars stay as they are. Round both slides' places (a slide of another size going
 * is never cut), and only where that leaves part of the layer out; none for a slide that fills or is cropped to the
 * screen, for the effects that move nothing, or under a transition of Drashti's own (which moves the whole layer).
 */
export function deckSlideClip(
  transition: DeckNativeTransition,
  placeIn: SlidePlace,
  placeOut: SlidePlace,
  canvas: { width: number; height: number },
): string {
  const moves =
    transition.deckEffect === 'push' ||
    transition.deckEffect === 'cover' ||
    transition.deckEffect === 'uncover';
  if (!moves || transition.over) return '';
  // In whole pixels (review LOW-2): a bar a part of a pixel wide is none.
  const whole = (v: number) => Math.max(0, Math.round(v));
  const top = whole(Math.min(placeIn.y, placeOut.y));
  const left = whole(Math.min(placeIn.x, placeOut.x));
  const bottom = whole(canvas.height - Math.max(placeIn.y + placeIn.height, placeOut.y + placeOut.height));
  const right = whole(canvas.width - Math.max(placeIn.x + placeIn.width, placeOut.x + placeOut.width));
  if (top === 0 && left === 0 && bottom === 0 && right === 0) return '';
  return `inset(${[top, right, bottom, left].map((v) => `${String(v)}px`).join(' ')})`;
}

/*
 * A deck's own Cover and Uncover as PowerPoint's own movie draws them (13 Nov 2026: the comparison's movie of a
 * generated deck, measured frame by frame at 320 x 180 against this drawing; Push already matched within a pixel).
 *
 * Cover and Uncover move their slide (Cover's incoming, Uncover's outgoing) on PowerPoint's own curve, not an easing:
 * measured every 21st of the way, across and up or down apart (PowerPoint's differ by up to 2.6% of the way), and
 * read between those points by a monotone cubic. PowerPoint draws that slide ×0.986 darker while the transition runs.
 */

/**
 * A monotone curve through values at even steps from 0 to 1 (Fritsch and Carlson's cubic: it never overshoots, so the
 * slide never moves back).
 */
function evenCurve(values: readonly number[]): (p: number) => number {
  const n = values.length - 1;
  const v = (i: number) => values[i] ?? 0;
  const slope = Array.from({ length: n }, (_, i) => (v(i + 1) - v(i)) * n);
  const s = (i: number) => slope[i] ?? 0;
  const tangent = values.map((_, i) =>
    i === 0 ? s(0) : i === n ? s(n - 1) : s(i - 1) * s(i) <= 0 ? 0 : (s(i - 1) + s(i)) / 2,
  );
  for (let i = 0; i < n; i++) {
    if (s(i) === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = (tangent[i] ?? 0) / s(i);
    const b = (tangent[i + 1] ?? 0) / s(i);
    if (a * a + b * b > 9) {
      const k = 3 / Math.sqrt(a * a + b * b);
      tangent[i] = k * a * s(i);
      tangent[i + 1] = k * b * s(i);
    }
  }
  return (p) => {
    if (p <= 0) return v(0);
    if (p >= 1) return v(n);
    const i = Math.min(n - 1, Math.floor(p * n));
    const t = p * n - i;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * v(i) +
      ((t3 - 2 * t2 + t) * (tangent[i] ?? 0)) / n +
      (-2 * t3 + 3 * t2) * v(i + 1) +
      ((t3 - t2) * (tangent[i + 1] ?? 0)) / n
    );
  };
}

/**
 * How far PowerPoint's Cover and Uncover have moved their slide (0: where it starts, 1: in place) every 21st of the
 * transition (33.3 ms of 700, the movie's frames), each direction's frames read there and the two of an axis averaged.
 */
const SLIDE_CURVES = {
  cover: {
    across: evenCurve([
      0, 0, 0, 0.0024, 0.0188, 0.0419, 0.07, 0.1112, 0.1799, 0.285, 0.4271, 0.5773, 0.718, 0.8268, 0.8945,
      0.9372, 0.9627, 0.9799, 0.9913, 0.9974, 1, 1,
    ]),
    down: evenCurve([
      0, 0, 0, 0, 0.0191, 0.0452, 0.0791, 0.128, 0.2005, 0.3107, 0.4476, 0.5967, 0.736, 0.8391, 0.905, 0.9427,
      0.9648, 0.9808, 0.9916, 0.9967, 1, 1,
    ]),
  },
  uncover: {
    across: evenCurve([
      0, 0.0025, 0.0088, 0.0211, 0.041, 0.0671, 0.1022, 0.1488, 0.2207, 0.3215, 0.4507, 0.5925, 0.7212,
      0.8224, 0.8865, 0.9281, 0.9579, 0.981, 0.9966, 1, 1, 1,
    ]),
    down: evenCurve([
      0, 0, 0.0042, 0.0121, 0.0283, 0.0513, 0.0803, 0.125, 0.194, 0.2979, 0.4366, 0.5857, 0.7257, 0.8289,
      0.8965, 0.9384, 0.9638, 0.9818, 0.9935, 1, 1, 1,
    ]),
  },
} as const;

/** The slide PowerPoint's Cover or Uncover moves, drawn this much darker while the transition runs (measured). */
const MOVING_SHADE = 'brightness(0.986)';

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
