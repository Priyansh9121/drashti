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
  return 1;
}

export function videoCueReady(_cue: VideoCue): boolean {
  return false;
}

export const VIDEO_GO_LEAD_MS = 120;
