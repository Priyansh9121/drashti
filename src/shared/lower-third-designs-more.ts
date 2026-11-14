import type { LowerThirdTemplate } from './lower-third-templates';
import type { LowerThirdLook } from './lower-thirds';

/** A template made since alpha.17 (Session 58), in lower-third-designs.ts's style. */
export interface MoreDesign {
  id: string;
  name: string;
  feel: LowerThirdTemplate['feel'];
  /** Its lines, placeholder words only; left out: a name and a role. */
  lines?: readonly [string, string, string];
  /** A design's move (lower-third-design-motions.ts), or an animation the studio offers (lower-third-studio.ts). */
  animation: string;
  /** How it goes out, when not as it came in: an animation the studio offers, played backwards. */
  outAnimation?: string;
  /** For an animation the studio offers (a design's move says its own): the side it comes from, and its kind. */
  direction?: LowerThirdTemplate['direction'];
  kind?: LowerThirdTemplate['kind'];
  look: Partial<LowerThirdLook> & Required<Pick<LowerThirdLook, 'style' | 'band' | 'accent'>>;
}

/**
 * The templates made since alpha.17 (Session 58), after lower-third-designs.ts's: original designs, placeholder words
 * only. Each is offered only while it stays smooth on a two-core computer without a graphics chip while streaming: the
 * Performance check's lower-thirds-more scenario plays each one's in and out on every screen
 * (main/lower-thirds/perf-lower-thirds.ts), and one that is not smooth there is left out by deleting it here (its
 * animation, background and style stay, so a lower third saved from it still draws as it was saved).
 */
export const MORE_LOWER_THIRD_DESIGNS: readonly MoreDesign[] = [];
