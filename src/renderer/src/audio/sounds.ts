import { type EngineState, videoClip, videoSeek } from '../../../shared/engine/state';
import { MUSIC_FADE_IN_MS, MUSIC_FADE_OUT_MS } from '../../../shared/music';
import type { PlaybackClip, PlaybackSeek } from '../../../shared/media';

/** One sound the show is making: a file, when it started, and how. */
export interface Sound {
  /** The same key is the same playback, carrying on. */
  key: string;
  mediaId: string;
  startedAt: number;
  loop: boolean;
  /** 0 to 1. */
  volume: number;
  /** An audio playlist's track (Session 14): it fades in as it starts and out as it stops. */
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Start and end points, and a jump to a marker (Session 14). */
  clip?: PlaybackClip;
  seek?: PlaybackSeek;
}

/**
 * Whether the engine has sent a sound that plays on somewhere new since `was`: a jump (a skip or a marker), or
 * new start or end points while it plays (Session 52), which move every screen's picture at once
 * (BackgroundMedia.tsx, SlideView.tsx). Its player then checks it against the clock at once (resync()), so it
 * lands there with its picture: asked only at a jump, a start point moved 0.2 s left the sound 0.2 s off,
 * short of the half second that makes a sound jump, easing back at 2% a second for 10 s.
 */
export function soundMoved(was: Sound, now: Sound): boolean {
  return (
    was.seek?.at !== now.seek?.at ||
    was.clip?.startMs !== now.clip?.startMs ||
    was.clip?.endMs !== now.clip?.endMs
  );
}

/**
 * Every sound the show should be making now: the audio layer, the
 * background video's sound, and the sound of videos on the live slide, each
 * from when it started (so it is in step with the pictures), and from where
 * the time bar moved it, or waiting where it paused it (Session 54). Black-out
 * hides pictures, not sound.
 */
export function soundsOf(state: EngineState): Sound[] {
  const sounds: Sound[] = [];
  const audio = state.layers.audio;
  // A paused audio playlist makes no sound (it fades out, and starts again where it was).
  if (audio?.mediaId && audio.pausedAtMs === undefined) {
    sounds.push({
      key: `audio:${audio.mediaId}@${audio.startedAt}`,
      mediaId: audio.mediaId,
      startedAt: audio.startedAt,
      loop: audio.loop,
      volume: audio.volume,
      ...(audio.music ? { fadeInMs: MUSIC_FADE_IN_MS, fadeOutMs: MUSIC_FADE_OUT_MS } : {}),
      ...(audio.clip ? { clip: audio.clip } : {}),
      ...(audio.seek ? { seek: audio.seek } : {}),
    });
  }
  const bg = state.layers.background;
  if (bg?.kind === 'media' && bg.media === 'video') {
    sounds.push({
      key: `background:${bg.mediaId}@${bg.startedAt}`,
      mediaId: bg.mediaId,
      startedAt: bg.startedAt,
      loop: bg.loop,
      volume: 1,
      ...(bg.clip ? { clip: bg.clip } : {}),
      ...(bg.seek ? { seek: bg.seek } : {}),
    });
  }
  const slide = state.layers.slide;
  if (slide) {
    for (const el of slide.slide.elements) {
      // A video whose sound is turned right down makes none.
      if (el.kind !== 'video' || el.volume === 0) continue;
      const clip = videoClip(slide.clips, el.mediaId);
      const seek = videoSeek(slide.seeks, el.mediaId);
      sounds.push({
        // By the slide's id, not its position: a new order for the live slide keeps its sound going.
        key: `slide:${slide.slide.id}/${el.id}@${slide.shownAt}`,
        mediaId: el.mediaId,
        startedAt: slide.shownAt,
        loop: el.loop ?? false,
        volume: el.volume ?? 1,
        // Between its file's start and end points, as its picture plays (Session 52), from where the time bar left it
        // (Session 54).
        ...(clip ? { clip } : {}),
        ...(seek ? { seek } : {}),
      });
    }
  }
  return sounds;
}
