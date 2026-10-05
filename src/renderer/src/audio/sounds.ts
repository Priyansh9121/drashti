import type { EngineState } from '../../../shared/engine/state';
import { MUSIC_FADE_IN_MS, MUSIC_FADE_OUT_MS } from '../../../shared/music';

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
}

/**
 * Every sound the show should be making now: the audio layer, the
 * background video's sound, and the sound of videos on the live slide, each
 * from when it started (so it is in step with the pictures). Black-out
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
    });
  }
  const slide = state.layers.slide;
  if (slide) {
    for (const el of slide.slide.elements) {
      // A video whose sound is turned right down makes none.
      if (el.kind !== 'video' || el.volume === 0) continue;
      sounds.push({
        // By the slide's id, not its position: a new order for the live slide keeps its sound going.
        key: `slide:${slide.slide.id}/${el.id}@${slide.shownAt}`,
        mediaId: el.mediaId,
        startedAt: slide.shownAt,
        loop: el.loop ?? false,
        volume: el.volume ?? 1,
      });
    }
  }
  return sounds;
}
