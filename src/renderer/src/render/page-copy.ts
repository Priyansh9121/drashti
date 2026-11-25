import { pageCopyUrl } from '../../../shared/media';

/*
 * This page's choice of a video's page copy (QA23-FADE-9 candidate 1; src/main/media/page-copies.ts). A page that
 * draws its videos smaller than they are says so once (the stream's picture page at its preset's height, the operator
 * window at 540p); the hall's screens never do, and play every original. A background video's playback asks here as
 * it starts (render/playback.ts, `pageCopy`): the smallest copy ready at or above this page's height, else the
 * original. Never below it, and never instead of a file a playback already has.
 */

/** This page's drawn height for its videos, or null (the hall's screens, and every page that never says). */
let pageHeight: number | null = null;
export function setPageCopyHeight(height: number | null): void {
  pageHeight = height;
}

/** The copies Main has ready, by media id (media:page-copies and its changes). */
let ready: Record<string, readonly number[]> = {};
export function setReadyPageCopies(next: Record<string, number[]>): void {
  ready = next;
}

/** The copy a playback starting now takes, or null for the original. */
export function pageCopyFor(mediaId: string, attempt = 0): string | null {
  const height = pageHeight;
  if (height === null || attempt > 0) return null;
  const heights = Object.hasOwn(ready, mediaId) ? (ready[mediaId] ?? []) : [];
  const pick = heights.filter((h) => h >= height).sort((a, b) => a - b)[0];
  return pick === 720 || pick === 540 ? pageCopyUrl(mediaId, pick) : null;
}
