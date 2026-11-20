import type { VideoEditRecipe } from './video-edit';
import type { PlaybackClip, PlaybackSeek } from './media';
import type { MediaMarkers, PlaybackMarker } from './markers';
import type { VideoCaptionTrack } from './video-captions';

/** Conversion is done once at a new showing; the regular player then runs at its normal clock rate. */
export function videoEditTimes(_recipe: VideoEditRecipe, _sourceLengthMs: number) {
  return {
    durationMs: 0,
    at: (ms: number) => ms,
    clip: (value: PlaybackClip | undefined) => value,
    marks: (values: readonly PlaybackMarker[]) => [...values],
    seek: (value: PlaybackSeek | undefined) => value,
    markers: (value: MediaMarkers) => value,
    captions: (value: VideoCaptionTrack) => value,
  };
}
