import type { MotionKind } from './appearances';

/*
 * When a live appearance's touch moves (Session 60, the owner's Q60-36 (3), his motion safety rule "Yes, A" and his
 * Q60-45 answer). A live look's touch moves only in the header and the band (appearance/LookMotion.tsx), and only
 * when nothing holds it:
 *  - Moving: Off in the Appearance window;
 *  - interface motion Off, or the computer set to reduce motion (nothing in Drashti's windows moves then);
 *  - no graphics chip (Chromium drawing in software has no frames to spare);
 *  - streaming or recording on a slow computer (four logical cores or fewer): the stream's encoder comes first;
 *  - the window still opening (Session 26g: it opens settled) or hidden.
 * Anything that holds it stops it at once; it starts again by itself when nothing does.
 */

/** A slow computer has this many logical cores or fewer (Q60-45). */
export const SLOW_CORES = 4;

/** Whether a computer with this many logical cores is slow. */
export const isSlow = (cores: number): boolean => cores <= SLOW_CORES;

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

/** Moving, or what holds it (the first that does, in this order). */
export type MovingNow = 'moving' | 'still' | 'off' | 'reduced' | 'no-chip' | 'busy' | 'opening' | 'hidden';

export function movingNow(f: MovingFacts): MovingNow {
  if (f.look.length === 0) return 'still';
  if (!f.on) return 'off';
  if (f.interfaceOff || f.reduced) return 'reduced';
  if (f.noGpu) return 'no-chip';
  if (f.busy && f.slow) return 'busy';
  if (!f.opened) return 'opening';
  if (f.hidden) return 'hidden';
  return 'moving';
}
