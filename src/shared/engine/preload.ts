import { nativeDeckMotion } from '../deck';
import type { UpNext } from './state';
import { deckStep, stepMedia } from '../deck-show';

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
  // A video input (Session 51) is live: nothing to load ahead.
  if (!next || next.kind === 'input') return [];
  if (next.kind === 'media')
    return next.media === 'audio' ? [] : [{ mediaId: next.mediaId, media: next.media }];
  const found = new Map<string, 'image' | 'video'>();
  if (next.background) found.set(next.background.mediaId, next.background.media);
  for (const el of next.slide.elements)
    if (el.kind === 'image' || el.kind === 'video') found.set(el.mediaId, el.kind);
  // The editable slide draws its backdrop and video posters alongside its animated shapes.
  if (nativeDeckMotion(next.slide.deck)) {
    if (next.slide.backdrop?.kind === 'picture') found.set(next.slide.backdrop.mediaId, 'image');
    for (const media of next.slide.deck?.media ?? []) if (media.posterId) found.set(media.posterId, 'image');
  }
  // A deck's step Next shows (Session 54, C2): its clip, last frame and hold, so it starts at once.
  for (const m of stepMedia(deckStep(next.slide.deck, next.step ?? 0))) found.set(m.mediaId, m.media);
  return [...found].map(([mediaId, media]) => ({ mediaId, media }));
}
