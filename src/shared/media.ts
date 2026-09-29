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
