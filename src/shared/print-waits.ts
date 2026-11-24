import { type EngineState, nothingUp } from './engine/state';

/*
 * When the three printers wait (alpha.22): the Manual's, a playlist's running order's and a kirtan's words'. Each
 * prints from a hidden window of its own (main/manual-print.ts), so none starts while the show is live: anything up,
 * or the stream on air (or getting there, or ending) or recording (the lead's call of 20 Nov 2026, the Manual's rule);
 * and, since Cue, a video waiting at Cue, its Go's files held, or one going out in a crossfade, whose moment a hidden
 * page's drawing must never cost a frame on the hall's screens (the lead's yes to a22-review-print S1; a save waits
 * for the same three: shared/save-waits.ts). Not known yet: the safe side, waiting. The main process asks this one test
 * for all three, of its own state.
 */
export function printWaits(state: EngineState | null | undefined, streamInUse: boolean): boolean {
  if (!state || streamInUse) return true;
  if (state.videoCue || state.videoStart || state.videoCrossfade) return true;
  return !nothingUp(state.layers);
}
