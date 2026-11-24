import { videoOverlapMs } from './video-crossfade';
import { mediaMarkersSchema } from './markers';
import { playbackLeftMs, playbackSpanMs } from './media';
import type { AudioLayer } from './engine/state';
import type { MusicPlaylist } from './music';
import { z } from 'zod';
import type { PlaylistItemInfo } from './playlists';

export const playlistPlayOptionsSchema = z
  .object({
    shuffle: z.boolean(),
    repeatAll: z.boolean(),
    crossfadeMs: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type PlaylistPlayOptions = z.infer<typeof playlistPlayOptionsSchema>;
export interface PlaylistPlayback extends PlaylistPlayOptions {
  playOrder: string[];
}

/** Use the saved draw without changing the rows’ numbered places. New ids go at its end. */
export function orderedPlaylistItems<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      out.push(item);
      byId.delete(id);
    }
  }
  for (const item of items) if (byId.delete(item.id)) out.push(item);
  return out;
}

/** Only consecutive playable video rows with Next item overlap; an intervening picture or sound stops it. */
function overlap(
  first: PlaylistItemInfo | undefined,
  second: PlaylistItemInfo | undefined,
  ms: number,
): number {
  if (
    first?.kind !== 'media' ||
    first.media !== 'video' ||
    first.whenEnds !== 'next' ||
    second?.kind !== 'media' ||
    second.media !== 'video' ||
    first.missing ||
    second.missing ||
    first.unplayable !== null ||
    second.unplayable !== null
  )
    return 0;
  return videoOverlapMs(
    ms,
    first.playingMs ?? first.durationMs ?? 0,
    second.playingMs ?? second.durationMs ?? 0,
  );
}

/** Timed media in this playlist, between their own start and end points. */
export function playlistTotals(
  items: readonly PlaylistItemInfo[],
  playback?: PlaylistPlayback,
): {
  rows: number;
  durationMs: number;
  unknown: number;
} {
  let durationMs = 0;
  let unknown = 0;
  for (const item of items) {
    if (item.kind !== 'media' || item.media === 'image') continue;
    const length = item.playingMs ?? item.durationMs;
    if (length == null) unknown++;
    else durationMs += length;
  }
  const ms = playback?.crossfadeMs ?? 0;
  if (ms > 0) {
    const order = orderedPlaylistItems(items, playback?.playOrder ?? []).filter(
      (i) =>
        i.kind !== 'header' &&
        i.kind !== 'placeholder' &&
        !(i.kind === 'media' && (i.missing || i.unplayable !== null)),
    );
    for (let index = 1; index < order.length; index++)
      durationMs -= overlap(order[index - 1], order[index], ms);
    if (playback?.repeatAll) durationMs -= overlap(order.at(-1), order[0], ms);
  }
  return { rows: items.length, durationMs, unknown };
}

/** Time left along automatic Next item links; null when its end cannot be known. */
export function playlistLeftMs(
  items: readonly PlaylistItemInfo[],
  order: readonly string[],
  liveId: string,
  leftMs: number,
  repeatAll: boolean,
  crossfadeMs = 0,
): number | null {
  if (repeatAll || !Number.isFinite(leftMs)) return null;
  const sorted = orderedPlaylistItems(items, order);
  const index = sorted.findIndex((i) => i.id === liveId);
  const current = sorted[index];
  if (current?.kind !== 'media' || current.media === 'image' || current.whenEnds === 'loop') return null;
  let left = Math.max(0, leftMs);
  let previous = current;
  for (const item of sorted.slice(index + 1)) {
    // A sound item ends on its own; it does not move the show’s cursor to the next item.
    if (previous.media !== 'video' || previous.whenEnds !== 'next') break;
    if (item.kind === 'header' || item.kind === 'placeholder') continue;
    if (item.kind === 'media' && (item.missing || item.unplayable !== null)) continue;
    if (item.kind === 'presentation' && item.presentationName === null) continue;
    if ((item.kind === 'input' || item.kind === 'shastra') && item.missing) continue;
    if (item.kind !== 'media' || item.media === 'image' || item.whenEnds === 'loop') return null;
    const length = item.playingMs ?? item.durationMs;
    if (length == null) return null;
    left += length - overlap(previous, item, crossfadeMs);
    previous = item;
  }
  return left;
}

/** The file’s length between its saved points, without trusting an unreadable record. */
export function mediaLengthBetweenPoints(durationMs: number | null, markers: string | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  let clip: { startMs: number; endMs: number | null } | undefined;
  try {
    const parsed = mediaMarkersSchema.safeParse(JSON.parse(markers ?? 'null'));
    if (parsed.success) clip = { startMs: parsed.data.startMs ?? 0, endMs: parsed.data.endMs };
  } catch {
    /* No readable points: play the whole file. */
  }
  const span = playbackSpanMs(clip, durationMs);
  return span.end - span.start;
}

/** The running audio order, including a saved shuffle, is the authority for its finish time. */
export function musicLeftMs(audio: AudioLayer, playlist: MusicPlaylist, now: number): number | null {
  const run = audio.music;
  if (run?.playlistId !== playlist.id || run.loop || audio.pausedAtMs !== undefined || audio.seek?.paused)
    return null;
  const byMedia = new Map(playlist.tracks.map((track) => [track.mediaId, track]));
  const current = audio.mediaId ? byMedia.get(audio.mediaId) : undefined;
  const duration = audio.durationMs ?? current?.durationMs;
  if (duration == null) return null;
  let left = playbackLeftMs(audio, duration, now);
  for (const track of run.tracks.slice(run.index + 1)) {
    const info = byMedia.get(track.mediaId);
    const length = info?.playingMs ?? info?.durationMs;
    if (length == null) return null;
    left += length;
  }
  return left;
}
