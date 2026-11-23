import type { BackgroundLayer, PlaylistCursor } from './engine/state';

/** A single resolved showing, kept from Cue through Go without reopening its source. */
export type CuedVideo = Extract<BackgroundLayer, { kind: 'media' }> & { media: 'video' };

export interface VideoCue {
  id: string;
  label: string;
  background: CuedVideo;
  playlist: PlaylistCursor | null;
  required: string[];
  ready: string[];
  error?: string;
  automatic?: { from: string; at: number; durationMs: number };
}

export interface VideoCrossfade {
  id: string;
  from: CuedVideo;
  at: number;
  durationMs: number;
  pausedAt?: number;
}

/** The same curve drives picture and sound on every page. */
export function videoFadeProgress(_fade: VideoCrossfade, _now: number): number {
  const at = _fade.pausedAt ?? _now;
  if (_fade.durationMs <= 0) return at < _fade.at ? 0 : 1;
  return Math.max(0, Math.min(1, (at - _fade.at) / _fade.durationMs));
}

export function videoCueReady(_cue: VideoCue): boolean {
  return !_cue.error && _cue.required.every((page) => _cue.ready.includes(page));
}

export const VIDEO_GO_LEAD_MS = 120;

/**
 * The stream's page draws its frames off screen on a fixed grid (30 a second): when it began one (the engine's clock,
 * ms) and how far apart they are. It tells Main while a cue waits (renderer/src/program/frame-grid.ts).
 */
export interface FrameGrid {
  at: number;
  periodMs: number;
}

/**
 * How long before one of the stream's frames a Go is placed. A 30-a-second stream can only show a cued video moving
 * at its first frame after the video's clock starts (1-11 ms after Go on CI, a21-s5); a Go just after one of its
 * frames waited a whole frame more (a21-s5-1123-121533-19312: the stream's start 33.8 ms). Placed this much before
 * one, its clock starts before that frame, and the stream starts within one frame of Go.
 */
export const STREAM_FRAME_MARGIN_MS = 20;

/** Not yet (the red): Go at its earliest, wherever the stream's frames fall. */
export function goOnStreamFrame(earliest: number, _grid: FrameGrid | null): number {
  return earliest;
}

/** Files retained through the shared future Go moment. */
export interface VideoStart {
  id: string;
  at: number;
  mediaIds: string[];
  soundIds: string[];
}
