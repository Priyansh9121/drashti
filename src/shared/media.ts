/*
 * How Drashti's windows load library media. They are sandboxed and never see
 * file paths: they ask the main process for a media item by id, through the
 * drashti-media:// scheme (src/main/media/media-protocol.ts).
 */

export const MEDIA_SCHEME = 'drashti-media';

/** A media id as the library stores it (a UUID); nothing else can name a file. */
export const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The URL that loads a media item's file. */
export function mediaUrl(mediaId: string): string {
  return `${MEDIA_SCHEME}://media/${mediaId}`;
}

/**
 * The URL of a small JPEG of an image or video (a still frame), for
 * thumbnails. `version` changes the URL once a still has just been made.
 */
export function stillUrl(mediaId: string, version = 0): string {
  return `${MEDIA_SCHEME}://still/${mediaId}${version > 0 ? `?v=${version}` : ''}`;
}

/** Stills are at most this wide (thumbnails are smaller), and this many bytes. */
export const STILL_WIDTH = 480;
export const STILL_MAX_BYTES = 1024 * 1024;

/**
 * Where a playback that started at `startedAt` (ms since the epoch) is at
 * `now`, in seconds: looping videos wrap, others stop at the end. Files that
 * do not say how long they are start from the top.
 */
export function playbackPosition(
  playback: { startedAt: number; loop: boolean },
  duration: number,
  now: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const elapsed = Math.max(0, (now - playback.startedAt) / 1000);
  return playback.loop ? elapsed % duration : Math.min(elapsed, duration);
}

export type SaveStillResult = { ok: true } | { ok: false; message: string };
