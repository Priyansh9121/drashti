import { type Playing, playingNow } from './engine/playing';
import type { EngineState } from './engine/state';
import { playbackSpanMs } from './media';

/*
 * What holds a save (alpha.22). The owner, 24 Nov 2026: "i am unable to save trimmed video, give proper option of save
 * trimmed video", on "Trim on a row". A row's Trim, Edit Video's Save and Export clip… waited while anything at all was
 * up (shared/engine/state.ts nothingUp): a still slide, a picture, a message, music. The Wallpaper covers what is up
 * without taking it off, so with the owner's Wallpaper up over a slide a save never began, its row saying only
 * Preparing. They make their video at the computer's lowest priority, so only what plays holds them now: a video (a
 * file, a video input, another app's window or a link) or a sound playing, whose playing the work could disturb, the
 * stream on air, or a recording. A still slide, a picture, the Wallpaper, black-out, a message, the ticker, a lower
 * third, a timer, or a video or sound paused never does. Each wait is said plainly, as the operator reads it.
 *
 * alpha.23 (the save-trim review's SHOULD-2): nor does a video or a sound that does not go round once it has played to
 * its end point. It may stay up there with nothing changing on LIVE: When it ends → Freeze keeps its last picture, as
 * does no wallpaper chosen, or a slide or the box over it. Until alpha.23 it held a save for good, saying "Waiting: a
 * video is playing" over a still picture. One whose length is not known yet still holds it (the safe side).
 */

/**
 * How long past its end point a video or a sound still holds a save (ms). The engine's own end comes at that moment
 * (When it ends → Next item or the wallpaper, an audio playlist's next track): a save begun in between would be
 * stopped again at once by what comes next.
 */
export const END_SETTLE_MS = 1000;

/**
 * When a video or a sound plays to its end point by itself (ms, the engine's clock), as shared/media.ts playbackAtMs
 * has it on every screen; null when it never does: paused, going round, or its length not known yet.
 */
function endsAt(p: Playing): number | null {
  if (p.paused || p.clock.loop || p.clock.pausedAtMs !== undefined) return null;
  const length = p.durationMs;
  if (length === undefined || !Number.isFinite(length) || length <= 0) return null;
  const { start, end } = playbackSpanMs(p.clock.clip, length);
  const seek = p.clock.seek;
  const from = seek ? Math.min(end, Math.max(start, seek.toMs)) : start;
  return (seek ? seek.at : p.clock.startedAt) + (end - from);
}

/** What plays on LIVE now, unpaused and not yet past its end point (and the moment after it). */
function stillPlaying(state: EngineState, now: number): Playing[] {
  return playingNow(state).filter((p) => {
    if (p.paused) return false;
    const ends = endsAt(p);
    return ends === null || now < ends + END_SETTLE_MS;
  });
}

export const SAVE_WAITS = {
  air: 'Waiting: the stream is on air',
  recording: 'Waiting: a recording is going on',
  video: 'Waiting: a video is playing',
  sound: 'Waiting: a sound is playing',
} as const;

export type SaveWait = (typeof SAVE_WAITS)[keyof typeof SAVE_WAITS];

/** What plays on LIVE at `now` (the engine's clock) that a save waits for: a video, a sound, or null for nothing playing. */
export function playingHolds(state: EngineState | null | undefined, now: number): 'video' | 'sound' | null {
  if (!state) return null;
  // A video cued to start at Go, waiting paused at its first frame, or one going out in a crossfade (Cue, alpha.22):
  // about to play, or playing, on the hall's screens.
  if (state.videoCue || state.videoCrossfade || state.videoStart) return 'video';
  const { background, pip } = state.layers;
  // Live pictures: a video input, another app's window or a link, as the background or in the box.
  if (background?.kind === 'input' || background?.kind === 'window' || background?.kind === 'link')
    return 'video';
  if (pip?.source.kind === 'input' || pip?.source.kind === 'window') return 'video';
  const playing = stillPlaying(state, now);
  if (playing.some((p) => p.ref.layer !== 'audio' && p.sound !== true)) return 'video';
  return playing.length > 0 ? 'sound' : null;
}

/** Why a save waits at `now` (the engine's clock), in the operator's words; null when it may go on. */
export function saveWaitsFor(
  state: EngineState | null | undefined,
  stream: { onAir: boolean; recording: boolean },
  now: number,
): SaveWait | null {
  if (stream.onAir) return SAVE_WAITS.air;
  if (stream.recording) return SAVE_WAITS.recording;
  const holds = playingHolds(state, now);
  return holds ? SAVE_WAITS[holds] : null;
}

/**
 * The next moment (the engine's clock) something playing now stops holding a save by itself, with nothing changing on
 * LIVE: the soonest end point (and the moment after it) of a video or a sound that does not go round. Null when
 * nothing playing ends by itself. The waiting saves look again then (main/convert/save-wake.ts; Edit Video's line).
 */
export function saveWaitEndsAt(state: EngineState | null | undefined, now: number): number | null {
  if (!state) return null;
  let soonest: number | null = null;
  for (const p of stillPlaying(state, now)) {
    const ends = endsAt(p);
    if (ends === null) continue;
    const at = ends + END_SETTLE_MS;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}
