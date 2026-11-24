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
 * How far ahead of its moment an automatic crossfade's Go is sent (ms; QA23-FADE-9, the owner: "Start it early, unheard
 * (Rec.)"): each page has it a second early, and the stream's sound page starts the incoming sound then, behind a delay
 * of the time left, so the audio clock says when it is heard (CI's two-core Windows: that page did nothing for 0.77 s
 * from a fade's start, and one Go lead ahead its incoming sound began 0.44 s late). The moment itself is the
 * playlist's own, as before; a cue ready later goes at once, at that moment.
 */
export const CROSSFADE_GO_LEAD_MS = 1000;

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

/**
 * The Go at or after `earliest` that is the margin before one of the stream's frames: the first frame at least the
 * margin after `earliest`, less the margin (so at most one frame later than `earliest`). No grid, or one that makes
 * no sense (a period outside 10-100 ms): `earliest`.
 */
export function goOnStreamFrame(earliest: number, grid: FrameGrid | null): number {
  if (!grid || !Number.isFinite(grid.at) || !(grid.periodMs >= 10 && grid.periodMs <= 100)) return earliest;
  const frames = Math.ceil((earliest + STREAM_FRAME_MARGIN_MS - grid.at) / grid.periodMs);
  return grid.at + frames * grid.periodMs - STREAM_FRAME_MARGIN_MS;
}

/** Files retained through the shared future Go moment. */
export interface VideoStart {
  id: string;
  at: number;
  mediaIds: string[];
  soundIds: string[];
}
