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
  return Math.max(0, Math.min(1, (at - _fade.at) / _fade.durationMs));
}

export function videoCueReady(_cue: VideoCue): boolean {
  return !_cue.error && _cue.required.every((page) => _cue.ready.includes(page));
}

export const VIDEO_GO_LEAD_MS = 120;
