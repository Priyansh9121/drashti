import type { MediaMarkers } from './markers';

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
export function storyFrame(_fraction: number): number {
  return 0;
}
/** Append a suggestion to an editor's draft, never persist or replace its markers. */
export function keepScene(points: MediaMarkers, _atMs: number, _id: string): MediaMarkers {
  return points;
}
