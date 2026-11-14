import type { DeckEffect, DeckSlide } from '../../../shared/deck';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { RenderSlide, SlideElement } from '../../../shared/model';

/*
 * The warm-up's deck (13 Nov 2026, the review of h-p3tr's part B; render/WarmUp.tsx draws it with the rest, through the
 * same Scene). A deck Drashti plays itself draws three things nothing else on a show screen does, each a new kind of
 * drawing for a GPU to make (100-600 ms on CI's Mac, every screen waiting) at a show's first one:
 * - its own Wipe: PowerPoint's soft band since Session 58 (transition-frame.ts wipeBandStyles), a gradient mask of 22
 *   stops that never changes on a box two slides long, moved over the slide coming in by a transform, the slide moved
 *   back inside it, each a layer of its own (Q57-28's mask moved its stops every frame and dropped frames);
 * - its own Cover and Uncover: the slide they move a shade darker, a brightness filter over the whole slide;
 * - a Split: a gradient mask the size of its shape (deck-target-paint.ts), of 4, 5 or 6 stops as it goes. A GPU draws
 *   a gradient of up to 4 stops, of up to 8 and of more each its own way, so it is drawn on three shapes, one at each.
 * The warm-up draws the Wipe and the Cover part-way, as Drashti's own transitions, from a deck's slide whose shapes are
 * part-way through their Splits. A computer without a graphics chip draws no warm-up (h-nogpu): nothing changes there.
 */

/** The deck's own transitions the warm-up draws (an Uncover draws as a Cover does: the slide it moves, shaded). */
export const WARM_DECK_TRANSITIONS = ['wipe', 'cover'] as const;
export type WarmDeckTransition = (typeof WARM_DECK_TRANSITIONS)[number];

/**
 * Half a pixel off the screen's pixel grid (Session 58, review-c2 MEDIUM-2): a deck's Wipe drawn there has the GPU draw
 * its mask as an anti-aliased rect (traced on CI's Mac at the first deck Wipe on air: AnalyticRRect with a gradient of
 * more than 8 stops), as a screen does where a slide's edges fall between pixels; the grid-aligned scene draws only the
 * pixel-aligned kind. The warm-up draws its deck Wipe once more, moved this much.
 */
export const OFF_GRID = 'translate(0.5px, 0.5px)';

/** A deck's own transition as the import gives one (import/deck/pptx-native-transition.ts), from the right. */
export function warmDeckTransition(effect: WarmDeckTransition, durationMs: number): DeckNativeTransition {
  return { kind: effect === 'wipe' ? 'wipe' : 'slide', deckEffect: effect, direction: 'left', durationMs };
}

/**
 * How long each shape's Split runs. Its slide goes up this long before the warm-up's moment, so each Split is where it
 * is put however long the slides before take to draw (seconds, on a GPU still making their pipelines): half a minute
 * either way still leaves each gradient its stops.
 */
export const SPLIT_MS = 600_000;

/**
 * Each shape's Split, by the slide's elements in order: its axis, whether its edges close in from the shape's own, and
 * how far through it is at the warm-up's moment (0 to 1).
 */
const SPLITS: readonly { axis: 'x' | 'y'; inward: boolean; at: number }[] = [
  // Its edges just parted from the middle, softly: 5 stops.
  { axis: 'x', inward: false, at: 0.06 },
  // Both soft edges inside the shape, closing in: 6 stops.
  { axis: 'y', inward: true, at: 0.5 },
  // Its edges reaching the shape's own: 4 stops.
  { axis: 'x', inward: false, at: 0.94 },
];

/**
 * `slide` as a deck's slide Drashti plays itself: its first three elements its shapes, each coming in by a Split that
 * is part-way SPLIT_MS after the slide goes up.
 */
export function withSplits(slide: RenderSlide): RenderSlide {
  const effects: DeckEffect[] = [];
  const elements = slide.elements.map((element, i) => {
    const split = SPLITS[i];
    if (!split) return element;
    const shapeId = String(i + 2);
    effects.push({
      shapeId,
      step: 0,
      phase: 'in',
      kind: 'split',
      splitAxis: split.axis,
      ...(split.inward ? { inward: true as const } : {}),
      delayMs: Math.round((1 - split.at) * SPLIT_MS),
      durationMs: SPLIT_MS,
    });
    return { ...element, sourceShapeId: shapeId };
  });
  const deck: DeckSlide = {
    steps: [],
    media: [],
    motion: {
      effects,
      stepsMs: [Math.max(0, ...effects.map((e) => e.delayMs + e.durationMs))],
      approximate: false,
    },
  };
  return { ...slide, elements, deck };
}

/**
 * How long each shape's Shape runs in the warm-up (Session 58): as long as a Split's, so either slide goes up as long
 * before the warm-up's moment.
 */
export const SHAPE_MS = SPLIT_MS;

/** A Shape the warm-up draws: its outline, In or Out, and how far through it is at the warm-up's moment (0 to 1). */
interface WarmShape {
  shape: NonNullable<DeckEffect['shape']>;
  inward: boolean;
  at: number;
}

/**
 * Each shape's Shape, by the slide's elements in order, and how far through it is at the warm-up's moment (0 to 1). Its
 * soft edge (shared/deck-motion.ts, shapeMasks) draws kinds of mask nothing else draws: a Circle a radial gradient of
 * 4 stops (both sides of its edge inside the shape); a Box a straight ramp over two half-planes (its wedges, laid by
 * mask-composite exclude), on the shape and again on an element within it; a Diamond the same with its ramps along its
 * diagonals.
 */
const SHAPES: readonly WarmShape[] = [
  { shape: 'circle', inward: true, at: 0.5 },
  { shape: 'box', inward: false, at: 0.5 },
  { shape: 'diamond', inward: true, at: 0.4 },
];

/**
 * One more Shape, on a placeholder of the warm-up's own (the slides it is given have three elements): a Plus Out near
 * the end of its way. A Box's, a Plus's or a Diamond's ramp has 5 or 6 stops for most of its way but 4 near either end
 * (an In's first ~12 %, an Out's last ~12 %), and a GPU draws a gradient of up to 4 stops and one of up to 8 each its
 * own way (C1's review, MEDIUM-1). Still part-way half a minute later. On the left of the slide, where the Cover's slide
 * coming in has not yet reached at the warm-up's moment.
 */
const LATE: WarmShape = { shape: 'plus', inward: false, at: 0.92 };
const LATE_PLACEHOLDER: SlideElement = {
  id: 'warm-up-shape-late',
  kind: 'shape',
  shape: 'rectangle',
  fill: '#5a2a48cc',
  cornerRadius: 0,
  opacity: 1,
  frame: { x: 80, y: 520, width: 600, height: 200 },
};

/**
 * `slide` as a deck's slide Drashti plays itself: its first three elements its shapes, each coming in by a Shape (a
 * Circle, a Box, a Diamond), and a placeholder of its own by a fourth (a Plus), each part-way SHAPE_MS after the slide
 * goes up.
 */
export function withShapes(slide: RenderSlide): RenderSlide {
  const effects: DeckEffect[] = [];
  const shaped = (element: SlideElement, one: WarmShape, i: number): SlideElement => {
    const shapeId = String(i + 2);
    effects.push({
      shapeId,
      step: 0,
      phase: 'in',
      kind: 'shape',
      shape: one.shape,
      ...(one.inward ? { inward: true as const } : {}),
      delayMs: Math.round((1 - one.at) * SHAPE_MS),
      durationMs: SHAPE_MS,
    });
    return { ...element, sourceShapeId: shapeId };
  };
  const elements = slide.elements.map((element, i) => {
    const one = SHAPES[i];
    return one ? shaped(element, one, i) : element;
  });
  elements.push(shaped(LATE_PLACEHOLDER, LATE, SHAPES.length));
  const deck: DeckSlide = {
    steps: [],
    media: [],
    motion: {
      effects,
      stepsMs: [Math.max(0, ...effects.map((e) => e.delayMs + e.durationMs))],
      approximate: false,
    },
  };
  return { ...slide, elements, deck };
}
