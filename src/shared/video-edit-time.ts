import type { VideoEditRecipe } from './video-edit';
import type { PlaybackClip, PlaybackSeek } from './media';
import type { MediaMarkers, PlaybackMarker } from './markers';
import type { VideoCaptionTrack } from './video-captions';

/** Conversion is done once at a new showing; the regular player then runs at its normal clock rate. */
export function videoEditTimes(recipe: VideoEditRecipe, sourceLengthMs: number) {
  const start = recipe.trim.startMs ?? 0;
  const end = recipe.trim.endMs ?? sourceLengthMs;
  const durationMs = (end - start) / recipe.speed;
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('The prepared video has no playing interval.');
  const at = (ms: number) => Math.max(0, Math.min(durationMs, (ms - start) / recipe.speed));
  const clip = (value: PlaybackClip | undefined): PlaybackClip | undefined => {
    if (!value) return undefined;
    const from = Math.max(start, value.startMs);
    const to = Math.min(end, value.endMs ?? end);
    if (to <= from)
      throw new Error('This row’s trim falls outside the edited video. Adjust its trim before showing it.');
    return { startMs: at(from), endMs: at(to) };
  };
  const marks = (values: readonly PlaybackMarker[]) =>
    values.filter((m) => m.atMs >= start && m.atMs <= end).map((m) => ({ ...m, atMs: at(m.atMs) }));
  const seek = (value: PlaybackSeek | undefined) => (value ? { ...value, toMs: at(value.toMs) } : undefined);
  const markers = (value: MediaMarkers): MediaMarkers => {
    const bounds = clip(
      value.startMs === null && value.endMs === null
        ? undefined
        : { startMs: value.startMs ?? 0, endMs: value.endMs },
    );
    return { startMs: bounds?.startMs ?? null, endMs: bounds?.endMs ?? null, markers: marks(value.markers) };
  };
  const captions = (value: VideoCaptionTrack): VideoCaptionTrack => ({
    ...value,
    cues: value.cues
      .filter((c) => c.endMs > start && c.startMs < end)
      .map((c) => ({ ...c, startMs: at(c.startMs), endMs: at(c.endMs) })),
  });
  return { durationMs, at, clip, marks, seek, markers, captions };
}
