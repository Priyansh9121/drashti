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
  | 'transform'
  | 'opacity'
  | 'clipPath'
  | 'maskImage'
  | 'maskComposite'
  | 'maskSize'
  | 'maskPosition'
  | 'maskClip'
  | 'outline'
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
 * How far a Split's mask reaches past the shape on every side, in its own px (Q58-55): its tile (mask-size and
 * mask-position) with `mask-clip: no-clip`, over a clear outline as wide so the shape draws that far. A mask on a box
 * whose edge falls between pixels drew that edge's row at three quarters, with a graphics chip and without (CI's Mac and
 * Windows: C22's diagnostics, a box 150.996 px high); reaching past it, that row is drawn as the rows above. 8 px is a
 * pixel and more of the screen's down to a sixth of the slide's size.
 */
const MASK_PAST = 8;

/**
 * One frame of a deck's moving shape, or of one part of a group drawn at `element` (the group's bounds are `target`):
 * its move, turn and size; how much of it shows; its wipe as a clip; and a Split's or a Shape's soft edges as a mask (a
 * CSS gradient on this same element, while it runs: the shape drawn through one more layer the size of its box, on the
 * screen's own drawing, nothing on Main), with a Box's, a Plus's or a Diamond's second mask on the element within it
 * (`inner`). Where this page draws without a graphics chip (render/chipless.ts), a Shape draws its hard edge, a clip
 * (deckShapeHardClip), in place of its masks: there they dropped frames on a two-core PC while streaming (C1's review,
 * HIGH-2). Only what changed is written.
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
  // A Split's mask on a tile reaching MASK_PAST px past the shape: its edges where they fall on that tile.
  const past = frame.wipe !== null && 'axis' in frame.wipe ? MASK_PAST : 0;
  const tile = past
    ? {
        x: element.x - past,
        y: element.y - past,
        width: element.width + 2 * past,
        height: element.height + 2 * past,
      }
    : element;
  const mask = hard ? '' : deckWipeMask(frame.wipe, target, tile);
  if (style.transform !== transform) style.transform = transform;
  if (style.opacity !== opacity) style.opacity = opacity;
  if (style.clipPath !== clip) style.clipPath = clip;
  const composite = mask ? deckWipeMaskComposite(frame.wipe) : '';
  if (style.maskImage !== mask) style.maskImage = mask;
  if (style.maskComposite !== composite) style.maskComposite = composite;
  const reach = mask && past;
  const size = reach ? `calc(100% + ${String(2 * past)}px) calc(100% + ${String(2 * past)}px)` : '';
  const position = reach ? `-${String(past)}px -${String(past)}px` : '';
  const maskClip = reach ? 'no-clip' : '';
  const outline = reach ? `${String(past)}px solid transparent` : '';
  if (style.maskSize !== size) style.maskSize = size;
  if (style.maskPosition !== position) style.maskPosition = position;
  if (style.maskClip !== maskClip) style.maskClip = maskClip;
  if (style.outline !== outline) style.outline = outline;
  if (!inner) return;
  const second = hard ? '' : deckWipeInnerMask(frame.wipe, target, element);
  const secondComposite = second ? deckWipeMaskComposite(frame.wipe) : '';
  if (inner.maskImage !== second) inner.maskImage = second;
  if (inner.maskComposite !== secondComposite) inner.maskComposite = secondComposite;
}
