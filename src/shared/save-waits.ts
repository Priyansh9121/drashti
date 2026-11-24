import { stepTiming } from './deck-show';
import { type Playing, playingNow } from './engine/playing';
import { type EngineState, videoSeek } from './engine/state';
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
 *
 * a22-review-trimsave (MUST-1, SHOULD-3): what plays on the hall beside the time bar's list holds a save too, by the
 * same end point: a slide's own sound or a deck's soundtrack over the operator's sound (audio.over; until now covered
 * only by accident, by the sound under it counting for good), a deck's transition sound as its slide comes in, and the
 * clip of the deck's step showing. A file's sound set to come later than its picture (Sound and picture…) holds it
 * until the sound has played out.
 */

/**
 * How long past its end point a video or a sound still holds a save (ms). The engine's own end comes at that very
 * moment (When it ends → Next item, an audio playlist's next track): a save begun in the instant before it would be
 * stopped again at once by what comes next. It also covers a sound player or a node a moment behind the engine.
 */
export const END_SETTLE_MS = 1000;

/** How much later than its picture a file's sound comes (ms, Sound and picture…; never less than none). */
function soundLater(state: EngineState, mediaId: string): number {
  const delays = state.sound?.delays;
  const delay = delays && Object.hasOwn(delays, mediaId) ? delays[mediaId] : undefined;
  return delay !== undefined && Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/**
 * When a video or a sound plays to its end point by itself (ms, the engine's clock), as shared/media.ts playbackAtMs
 * has it on every screen, and its sound after it when set to come later; null when it never does: paused, going
 * round, or its length not known yet.
 */
function endsAt(state: EngineState, p: Playing): number | null {
  if (p.paused || p.clock.loop || p.clock.pausedAtMs !== undefined) return null;
  const length = p.durationMs;
  if (length === undefined || !Number.isFinite(length) || length <= 0) return null;
  const { start, end } = playbackSpanMs(p.clock.clip, length);
  const seek = p.clock.seek;
  const from = seek ? Math.min(end, Math.max(start, seek.toMs)) : start;
  return (seek ? seek.at : p.clock.startedAt) + (end - from) + soundLater(state, p.mediaId);
}

/** A sound as the time bar would have it, for one it does not list. */
const soundPlaying = (
  ref: Playing['ref'],
  mediaId: string,
  clock: Playing['clock'],
  durationMs: number | undefined,
  paused: boolean,
): Playing => ({
  ref,
  mediaId,
  clock,
  durationMs,
  marks: [],
  track: false,
  paused,
  sound: true,
});

/**
 * What plays on the hall beside the time bar's list (a22-review-trimsave MUST-1, SHOULD-3), each as the bar would
 * have it, so the same end point holds a save while it plays and never longer.
 */
function besideTheBar(state: EngineState): Playing[] {
  const found: Playing[] = [];
  // A slide's own sound or a deck's soundtrack over the operator's sound: the audio player plays it whatever the sound
  // under it does (ended, paused, between tracks), as shared/sound.ts overPlaysAt has it.
  const over = state.layers.audio?.over;
  if (over?.mediaId)
    found.push(
      soundPlaying(
        { layer: 'audio' },
        over.mediaId,
        over,
        over.durationMs,
        over.pausedAtMs !== undefined || over.seek?.paused === true,
      ),
    );
  const slide = state.layers.slide;
  if (!slide) return found;
  // Its deck's transition sound, once, as the slide comes in, from when the engine stamped it (audio/sounds.ts): none
  // when Drashti's own transition came instead, or after a jump.
  const chime = slide.slide.deck?.transition?.soundId;
  const rang = chime ? videoSeek(slide.seeks, chime) : undefined;
  if (chime && rang && !rang.waiting)
    found.push(
      soundPlaying(
        { layer: 'slide', mediaId: chime },
        chime,
        { startedAt: slide.shownAt, loop: false, seek: rang },
        state.videoFiles?.[chime]?.durationMs,
        rang.paused === true,
      ),
    );
  // The deck's step showing: its clip plays from its click on every screen (shared/deck-show.ts stepTiming), then its
  // last frame stays. A step come back to shows that frame at once. Its loop while it waits for the next click (holdId)
  // goes round for as long as the step is up: the slide's own motion, as a slide's transitions and animations are
  // (alpha.22), so it holds no save.
  const timing = stepTiming(slide);
  if (timing && !timing.still && timing.step.clipMs > 0)
    found.push({
      ref: { layer: 'slide', mediaId: timing.step.clipId },
      mediaId: timing.step.clipId,
      clock: { startedAt: timing.clipAt, loop: false },
      durationMs: timing.step.clipMs,
      marks: [],
      track: false,
      paused: false,
    });
  return found;
}

/** What plays on the hall now, unpaused and not yet past its end point (and the moment after it). */
function stillPlaying(state: EngineState, now: number): Playing[] {
  return [...playingNow(state), ...besideTheBar(state)].filter((p) => {
    if (p.paused) return false;
    const ends = endsAt(state, p);
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
    const ends = endsAt(state, p);
    if (ends === null) continue;
    const at = ends + END_SETTLE_MS;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}
