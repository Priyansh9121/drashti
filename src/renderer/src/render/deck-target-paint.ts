import type { DeckEffect } from '../../../shared/deck';
import {
  type DeckMotionFrame,
  deckWipeClip,
  deckWipeInnerMask,
  deckWipeMask,
} from '../../../shared/deck-motion';
import type { Rect } from '../../../shared/model';

/** What a deck's moving shape writes of its style (an element's own, or a test's stand-in). */
export type DeckTargetStyle = Pick<CSSStyleDeclaration, 'transform' | 'opacity' | 'clipPath' | 'maskImage'>;

/** What the element within a moving shape writes of its style: its own mask, multiplying the shape's. */
export type DeckTargetInnerStyle = Pick<CSSStyleDeclaration, 'maskImage'>;

/**
 * Whether a deck's moving shape needs an element of its own within it for a second mask (deckWipeInnerMask): a Shape's
 * Box, Plus or Diamond, whose soft edge is two masks multiplied (shared/deck-motion.ts, shapeMasks). Known when the
 * slide is drawn, so the element is there from the start and nothing is drawn again as the effect begins.
 */
export function deckTargetMaskedTwice(effects: readonly DeckEffect[]): boolean {
  return effects.some((effect) => effect.kind === 'shape' && (effect.shape ?? 'circle') !== 'circle');
}

/**
 * One frame of a deck's moving shape, or of one part of a group drawn at `element` (the group's bounds are `target`):
 * its move, turn and size; how much of it shows; its wipe as a clip; and a Split's or a Shape's soft edges as a mask (a
 * CSS gradient on this same element, while it runs: the shape drawn through one more layer the size of its box, on the
 * screen's own drawing, nothing on Main), with a Box's, a Plus's or a Diamond's second mask on the element within it
 * (`inner`). Only what changed is written.
 */
export function paintDeckTarget(
  style: DeckTargetStyle,
  frame: DeckMotionFrame,
  target: Rect,
  element: Rect,
  inner?: DeckTargetInnerStyle | null,
): void {
  const rotation = frame.rotation % 360;
  const transform =
    frame.x || frame.y || rotation || frame.scale !== 1
      ? `translate(${String(frame.x)}px, ${String(frame.y)}px) rotate(${String(rotation)}deg) scale(${String(frame.scale)})`
      : '';
  const opacity = frame.opacity === 1 ? '' : String(frame.opacity);
  const clip = deckWipeClip(frame.wipe, target, element);
  const mask = deckWipeMask(frame.wipe, target, element);
  if (style.transform !== transform) style.transform = transform;
  if (style.opacity !== opacity) style.opacity = opacity;
  if (style.clipPath !== clip) style.clipPath = clip;
  if (style.maskImage !== mask) style.maskImage = mask;
  if (!inner) return;
  const second = deckWipeInnerMask(frame.wipe, target, element);
  if (inner.maskImage !== second) inner.maskImage = second;
}
