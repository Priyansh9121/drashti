import type { DeckEffect, DeckSlide } from '../../../shared/deck';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { RenderSlide } from '../../../shared/model';

/*
 * The warm-up's deck (13 Nov 2026, the review of h-p3tr's part B; render/WarmUp.tsx draws it with the rest, through the
 * same Scene). A deck Drashti plays itself draws three things nothing else on a show screen does, each a new kind of
 * drawing for a GPU to make (100-600 ms on CI's Mac, every screen waiting) at a show's first one:
 * - its own Wipe: a gradient mask of 21 stops over the whole slide coming in (transition-frame.ts);
 * - its own Cover and Uncover: the slide they move a shade darker, a brightness filter over the whole slide;
 * - a Split: a gradient mask the size of its shape (deck-target-paint.ts), of 4, 5 or 6 stops as it goes. A GPU draws
 *   a gradient of up to 4 stops, of up to 8 and of more each its own way, so it is drawn on three shapes, one at each.
 * The warm-up draws the Wipe and the Cover part-way, as Drashti's own transitions, from a deck's slide whose shapes are
 * part-way through their Splits. A computer without a graphics chip draws no warm-up (h-nogpu): nothing changes there.
 */

/** The deck's own transitions the warm-up draws (an Uncover draws as a Cover does: the slide it moves, shaded). */
export const WARM_DECK_TRANSITIONS = ['wipe', 'cover'] as const;
export type WarmDeckTransition = (typeof WARM_DECK_TRANSITIONS)[number];

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
