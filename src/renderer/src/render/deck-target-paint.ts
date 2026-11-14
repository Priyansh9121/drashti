import type { DeckEffect } from '../../../shared/deck';
import {
  type DeckMotionFrame,
  deckShapeHardClip,
  deckWipeClip,
  deckWipeInnerMask,
  deckWipeMask,
  deckWipeMaskComposite,
} from '../../../shared/deck-motion';
import type { Rect } from '../../../shared/model';
import { drawsWithoutChip } from './chipless';

/** What a deck's moving shape writes of its style (an element's own, or a test's stand-in). */
export type DeckTargetStyle = Pick<
  CSSStyleDeclaration,
  'transform' | 'opacity' | 'clipPath' | 'maskImage' | 'maskComposite' | 'willChange'
>;

/** What the element within a moving shape writes of its style: its own mask, multiplying the shape's. */
export type DeckTargetInnerStyle = Pick<CSSStyleDeclaration, 'maskImage' | 'maskComposite'>;

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
 * (`inner`). Where this page draws without a graphics chip (render/chipless.ts), a Shape draws its hard edge, a clip
 * (deckShapeHardClip), in place of its masks: there they dropped frames on a two-core PC while streaming (C1's review,
 * HIGH-2); a Split's mask makes the shape a layer of its own while it is on (Q58-55). Only what changed is written.
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
  const hard = frame.wipe !== null && 'shape' in frame.wipe && drawsWithoutChip();
  const clip = hard
    ? deckShapeHardClip(frame.wipe, target, element)
    : deckWipeClip(frame.wipe, target, element);
  const mask = hard ? '' : deckWipeMask(frame.wipe, target, element);
  if (style.transform !== transform) style.transform = transform;
  if (style.opacity !== opacity) style.opacity = opacity;
  if (style.clipPath !== clip) style.clipPath = clip;
  const composite = mask ? deckWipeMaskComposite(frame.wipe) : '';
  if (style.maskImage !== mask) style.maskImage = mask;
  if (style.maskComposite !== composite) style.maskComposite = composite;
  // Without a chip, a layer of its own while masked: drawn in software into its parent's layer, a mask on a box whose
  // edge falls between pixels drew that edge's row at three quarters, any mask (CI's Windows: Q58-55); on a layer of
  // its own, exactly. (Its cost the same: the mask is drawn again each frame either way.)
  const layer = mask && drawsWithoutChip() ? 'transform' : '';
  if (style.willChange !== layer) style.willChange = layer;
  if (!inner) return;
  const second = hard ? '' : deckWipeInnerMask(frame.wipe, target, element);
  const secondComposite = second ? deckWipeMaskComposite(frame.wipe) : '';
  if (inner.maskImage !== second) inner.maskImage = second;
  if (inner.maskComposite !== secondComposite) inner.maskComposite = secondComposite;
}
