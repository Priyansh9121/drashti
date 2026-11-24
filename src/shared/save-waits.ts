import { playingNow } from './engine/playing';
import type { EngineState } from './engine/state';

/*
 * What holds a save (alpha.22). The owner, 24 Nov 2026: "i am unable to save trimmed video, give proper option of save
 * trimmed video", on "Trim on a row". A row's Trim, Edit Video's Save and Export clip… waited while anything at all was
 * up (shared/engine/state.ts nothingUp): a still slide, a picture, a message, music. The Wallpaper covers what is up
 * without taking it off, so with the owner's Wallpaper up over a slide a save never began, its row saying only
 * Preparing. They make their video at the computer's lowest priority, so only what plays holds them now: a video (a
 * file, a video input, another app's window or a link) or a sound playing, whose playing the work could disturb, the
 * stream on air, or a recording. A still slide, a picture, the Wallpaper, black-out, a message, the ticker, a lower
 * third, a timer, or a video or sound paused never does. Each wait is said plainly, as the operator reads it.
 */

export const SAVE_WAITS = {
  air: 'Waiting: the stream is on air',
  recording: 'Waiting: a recording is going on',
  video: 'Waiting: a video is playing',
  sound: 'Waiting: a sound is playing',
} as const;

export type SaveWait = (typeof SAVE_WAITS)[keyof typeof SAVE_WAITS];

/** What plays on LIVE that a save waits for: a video, a sound, or null for nothing playing. */
export function playingHolds(state: EngineState | null | undefined): 'video' | 'sound' | null {
  if (!state) return null;
  // A video cued to start at Go, waiting paused at its first frame, or one going out in a crossfade (Cue, alpha.22):
  // about to play, or playing, on the hall's screens.
  if (state.videoCue || state.videoCrossfade || state.videoStart) return 'video';
  const { background, pip } = state.layers;
  // Live pictures: a video input, another app's window or a link, as the background or in the box.
  if (background?.kind === 'input' || background?.kind === 'window' || background?.kind === 'link')
    return 'video';
  if (pip?.source.kind === 'input' || pip?.source.kind === 'window') return 'video';
  const playing = playingNow(state).filter((p) => !p.paused);
  if (playing.some((p) => p.ref.layer !== 'audio' && p.sound !== true)) return 'video';
  return playing.length > 0 ? 'sound' : null;
}

/** Why a save waits now, in the operator's words; null when it may go on. */
export function saveWaitsFor(
  state: EngineState | null | undefined,
  stream: { onAir: boolean; recording: boolean },
): SaveWait | null {
  if (stream.onAir) return SAVE_WAITS.air;
  if (stream.recording) return SAVE_WAITS.recording;
  const holds = playingHolds(state);
  return holds ? SAVE_WAITS[holds] : null;
}
