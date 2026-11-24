import type { CorrectionLimits } from '../../../shared/media';
import type { VideoCrossfade } from '../../../shared/video-cue';
import type { SlotLayer } from './background-slots';
import { engineNow } from './clock';

/*
 * A crossfade's two pictures (lead 2's QF-1, the next release; a22-fade-picture). Red: not yet brought back by speed.
 */

/** Whether a real crossfade is on now. */
export function crossfadeOn(_fade: VideoCrossfade | null | undefined, _now: number): boolean {
  return false;
}

/** The crossfade a background picture is one of the two of, or null. */
export function crossfadeOf(
  _fade: VideoCrossfade | null | undefined,
  _slot: { key: string; layer: SlotLayer },
): VideoCrossfade | null {
  return null;
}

/** startPlayback's `ease` for a background picture. */
export function pictureEase(
  _fade: () => VideoCrossfade | null,
  _now: () => number = engineNow,
): () => CorrectionLimits | null {
  return () => null;
}
