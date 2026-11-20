import type { MotionKind } from './appearances';

/*
 * When a live appearance's touch moves (Session 60, the owner's Q60-36 (3), his motion safety rule "Yes, A" and his
 * Q60-45 answer). Not yet decided: the red tests say how.
 */

/** A slow computer has this many logical cores or fewer (Q60-45). */
export const SLOW_CORES = 4;

export const isSlow = (_cores: number): boolean => false;

/** What holds a live look still, or lets it move. */
export interface MovingFacts {
  /** The shown appearance's motions (none: a still one). */
  look: readonly MotionKind[];
  /** Moving: On. */
  on: boolean;
  /** Interface motion is Off. */
  interfaceOff: boolean;
  /** The computer is set to reduce motion. */
  reduced: boolean;
  /** Chromium draws without a graphics chip. */
  noGpu: boolean;
  /** The stream is on air or recording. */
  busy: boolean;
  /** This computer has SLOW_CORES logical cores or fewer. */
  slow: boolean;
  /** The window has opened settled (ui/motion.ts). */
  opened: boolean;
  /** The window is hidden or minimised. */
  hidden: boolean;
}

export type MovingNow = 'moving' | 'still' | 'off' | 'reduced' | 'no-chip' | 'busy' | 'opening' | 'hidden';

export function movingNow(_facts: MovingFacts): MovingNow {
  return 'moving';
}
