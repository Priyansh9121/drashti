import { type DeckMotionFrame, deckWipeClip, deckWipeMask } from '../../../shared/deck-motion';
import type { Rect } from '../../../shared/model';

/** What a deck's moving shape writes of its style (an element's own, or a test's stand-in). */
export type DeckTargetStyle = Pick<CSSStyleDeclaration, 'transform' | 'opacity' | 'clipPath' | 'maskImage'>;

/**
 * One frame of a deck's moving shape, or of one part of a group drawn at `element` (the group's bounds are `target`):
 * its move, turn and size; how much of it shows; its wipe as a clip; and a Split's soft edges as a mask (a CSS linear
 * gradient on this same element, while the Split runs: the shape drawn through one more layer the size of its box,
 * on the screen's own drawing, nothing on Main). Only what changed is written.
 */
export function paintDeckTarget(
  style: DeckTargetStyle,
  frame: DeckMotionFrame,
  target: Rect,
  element: Rect,
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
}
