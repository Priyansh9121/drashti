import { z } from 'zod';

/*
 * Playback markers (Session 14). A video or a sound in the media library
 * can have a start point and an end point (it plays between them; a
 * background video, or a looping sound, loops between them) and named
 * markers to jump to while it plays (from the live preview, or a phone).
 * They belong to the file, so every use of it plays the same part. Every
 * screen and the audio player work out where it is from the engine's clock
 * (shared/media.ts playbackPosition), so a jump lands in step everywhere.
 * Imported from ProPresenter 7 (a media cue's markers, and its in and out
 * points) and 6 (a video's in and out points), following the community
 * notes on the formats: unconfirmed until real files are tried.
 */

export interface PlaybackMarker {
  id: string;
  name: string;
  /** Where it is, in ms from the start of the file. */
  atMs: number;
}

export interface MediaMarkers {
  /** Plays from here (ms), or from the start (null). */
  startMs: number | null;
  /** Plays up to here (ms), or to the end (null). */
  endMs: number | null;
  markers: PlaybackMarker[];
}

export const NO_MARKERS: MediaMarkers = { startMs: null, endMs: null, markers: [] };

const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600 * 1000);

export const mediaMarkersSchema: z.ZodType<MediaMarkers> = z
  .object({
    startMs: ms.nullable(),
    endMs: ms.nullable(),
    markers: z
      .array(z.object({ id: z.string().min(1).max(64), name: z.string().trim().min(1).max(60), atMs: ms }))
      .max(50),
  })
  .refine((m) => m.startMs === null || m.endMs === null || m.endMs > m.startMs, {
    message: 'The end point must come after the start point.',
  });

export type MarkersResult = { ok: true; markers: MediaMarkers } | { ok: false; message: string };

/** "1:05.3" for a point in a file. */
export function markerTime(msValue: number): string {
  const tenths = Math.round(msValue / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${String(m)}:${s.toFixed(1).padStart(4, '0')}`;
}

/** A typed time ("1:05.3", "65.3", "1:05") in ms, or null when it cannot be read. */
export function parseMarkerTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/u.exec(text);
  if (!m) return null;
  const value = Math.round((Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000);
  return Number.isFinite(value) ? value : null;
}
