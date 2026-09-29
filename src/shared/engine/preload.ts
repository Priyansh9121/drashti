import type { UpNext } from './state';

/** An image or video an output loads before it is needed. */
export interface PreloadMedia {
  mediaId: string;
  media: 'image' | 'video';
}

/**
 * The images and videos the next slide (or next media item) will show: its
 * background and everything placed on it, each once. Outputs load and
 * decode them ahead, so they appear in the same frame as the slide.
 */
export function mediaToPreload(next: UpNext | null): PreloadMedia[] {
  if (!next) return [];
  if (next.kind === 'media')
    return next.media === 'audio' ? [] : [{ mediaId: next.mediaId, media: next.media }];
  const found = new Map<string, 'image' | 'video'>();
  if (next.background) found.set(next.background.mediaId, next.background.media);
  for (const el of next.slide.elements)
    if (el.kind === 'image' || el.kind === 'video') found.set(el.mediaId, el.kind);
  return [...found].map(([mediaId, media]) => ({ mediaId, media }));
}
