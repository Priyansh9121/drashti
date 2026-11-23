import { markerTime, type MediaMarkers } from './markers';

export const ANALYSIS_VERSION = 1;
export const WAVEFORM_BUCKETS = 4096;
export const STORY_FRAMES = 20;
export const STORY_WIDTH = 160;
export const STORY_HEIGHT = 90;
export interface WaveformData {
  durationMs: number;
  peaks: [number, number][];
}
export interface VideoAnalysis {
  mediaId: string;
  audioStream: number | null;
  state: 'waiting' | 'preparing' | 'ready' | 'failed';
  note: string | null;
  message: string | null;
  durationMs: number;
  waveform: WaveformData | null;
  scenes: number[];
  /** A bounded generated JPEG, never a local path. */
  storyboard: string | null;
}
export type VideoAnalysisResult = { ok: true; analysis: VideoAnalysis } | { ok: false; message: string };
export function storyFrame(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(STORY_FRAMES - 1, Math.floor(fraction * STORY_FRAMES)));
}
/** Append a suggestion to an editor's draft, never persist or replace its markers. */
export function keepScene(points: MediaMarkers, atMs: number, id: string): MediaMarkers {
  if (points.markers.length >= 50 || points.markers.some((m) => m.atMs === atMs)) return points;
  if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs > 86_400_000) return points;
  return {
    ...points,
    markers: [...points.markers, { id, name: `Scene ${markerTime(atMs)}`, atMs }].sort(
      (a, b) => a.atMs - b.atMs,
    ),
  };
}
