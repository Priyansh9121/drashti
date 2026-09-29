import type { EngineState } from '../../../shared/engine/state';

/** One sound the show is making: a file, when it started, and how. */
export interface Sound {
  /** The same key is the same playback, carrying on. */
  key: string;
  mediaId: string;
  startedAt: number;
  loop: boolean;
  /** 0 to 1. */
  volume: number;
}

/**
 * Every sound the show should be making now: the background video's sound,
 * and the sound of videos on the live slide, each from when it started (so
 * it is in step with the pictures). Black-out hides pictures, not sound.
 */
export function soundsOf(state: EngineState): Sound[] {
  const sounds: Sound[] = [];
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
      if (el.kind !== 'video') continue;
      sounds.push({
        key: `slide:${slide.presentationId}/${slide.slideIndex}/${el.id}@${slide.shownAt}`,
        mediaId: el.mediaId,
        startedAt: slide.shownAt,
        loop: el.loop ?? false,
        volume: 1,
      });
    }
  }
  return sounds;
}
