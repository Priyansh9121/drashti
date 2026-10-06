import { randomUUID } from 'node:crypto';
import type { MediaMarkers } from '../../shared/markers';
import type { ParsedMediaRef } from './model';

/*
 * Playback markers and start and end points read from the older formats
 * (Session 14), following the community notes on them; no file on the dev
 * Mac has them, so they are unconfirmed until the mandir's own files are
 * tried. ProPresenter 7: a media cue's markers (a time in seconds and a
 * name) and its file's in and out points (seconds). ProPresenter 6: a
 * video's in and out points, in units of its time scale.
 */

const ms = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/** Points and markers from seconds, or null when they say nothing (the whole file, no markers). */
export function markersFrom(
  inSeconds: number,
  outSeconds: number,
  endSeconds: number,
  markers: { name: string; seconds: number }[],
): MediaMarkers | null {
  const startMs = inSeconds > 0 ? ms(inSeconds) : null;
  // An out point at (or past) the file's end, or none, plays to the end.
  const endMs = outSeconds > 0 && (endSeconds <= 0 || outSeconds < endSeconds - 0.01) ? ms(outSeconds) : null;
  const named = markers
    .filter((m) => m.name.trim() !== '' && Number.isFinite(m.seconds) && m.seconds >= 0)
    .slice(0, 50)
    .map((m) => ({ id: randomUUID(), name: m.name.trim().slice(0, 60), atMs: ms(m.seconds) }));
  if (startMs === null && endMs === null && named.length === 0) return null;
  return {
    startMs,
    endMs: endMs !== null && startMs !== null && endMs <= startMs ? null : endMs,
    markers: named,
  };
}

/** ProPresenter 6: inPoint, outPoint and endPoint in units of timeScale (600 a second unless it says). */
export function pp6Markers(attrs: Record<string, string | undefined>): MediaMarkers | null {
  const scale = Number(attrs['timeScale']) > 0 ? Number(attrs['timeScale']) : 600;
  const value = (name: string) => {
    const n = Number(attrs[name]);
    return Number.isFinite(n) && n > 0 ? n / scale : 0;
  };
  return markersFrom(value('inPoint'), value('outPoint'), value('endPoint'), []);
}

/** A file's first markers win: later uses of the same file keep them. */
export function keepMarkers(ref: ParsedMediaRef | undefined, markers: MediaMarkers | null): void {
  if (ref && markers && !ref.markers) ref.markers = markers;
}
