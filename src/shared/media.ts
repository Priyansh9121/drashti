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
