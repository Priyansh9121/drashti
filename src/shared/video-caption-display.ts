import {
  captionLines,
  CAPTION_LINE_CHARS,
  captionsFor,
  type CaptionScreen,
  type CaptionSize,
  type CaptionPlace,
} from './captions';
import { playingNow } from './engine/playing';
import type { EngineState } from './engine/state';
import type { PlaybackClip } from './media';
import { captionAt } from './video-captions';

export interface ActualVideoClock {
  mediaId: string;
  sourceMs: number;
  clip?: PlaybackClip;
}
export interface CaptionBand {
  fit?: true;
  lines: string[];
  language: string;
  size: CaptionSize;
  place: CaptionPlace;
  source: 'live' | 'video';
}

/** One caption band. Video choices are library data; live speech keeps its original audience policy. */
export function captionBandFor(
  state: EngineState,
  screen: CaptionScreen,
  actual: ActualVideoClock | null,
): CaptionBand | null {
  const playing = playingNow(state).find(
    (p) => p.ref.layer !== 'audio' && !p.sound && !p.clock.seek?.waiting && state.videoCaptions?.[p.mediaId],
  );
  if (playing) {
    if (
      screen === 'stage' ||
      state.blackout ||
      state.wallpaper ||
      state.stopped ||
      actual?.mediaId !== playing.mediaId
    )
      return null;
    const chosen = state.videoCaptions?.[playing.mediaId];
    if (!chosen) return null;
    // Sound and picture… (alpha.20): the captions' own delay against the picture.
    const cue = captionAt(chosen.track.cues, actual.sourceMs, actual.clip, chosen.delayMs ?? 0);
    if (!cue) return null;
    const lines = captionLines(cue.text.split(/\s+/u), CAPTION_LINE_CHARS[chosen.size]);
    return {
      lines,
      language: chosen.track.language,
      size: chosen.size,
      place: chosen.place,
      source: 'video',
    };
  }
  const live = captionsFor(state.captions, screen);
  return live
    ? { ...live, language: live.language === 'sa' ? 'sa-Gujr' : live.language, source: 'live' }
    : null;
}
