import { mediaUrl, pageCopyUrl } from '../../../shared/media';

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
  // A page saying its height afresh starts afresh (each test does).
  if (height === null) failed.clear();
}

/** The copies Main has ready, by media id (media:page-copies and its changes). */
let ready: Record<string, readonly number[]> = {};
export function setReadyPageCopies(next: Record<string, number[]>): void {
  ready = next;
}

/** Videos whose copy failed on this page (a22-review-fadecopies M1): the original from then on, here. */
const failed = new Set<string>();
/** A copy that failed to play here: this page plays that video's original from now on. */
export function pageCopyFailed(mediaId: string): void {
  failed.add(mediaId);
}

/** The copy a playback starting now takes, or null for the original. */
export function pageCopyFor(mediaId: string, attempt = 0): string | null {
  const height = pageHeight;
  if (height === null || attempt > 0 || failed.has(mediaId)) return null;
  const heights = Object.hasOwn(ready, mediaId) ? (ready[mediaId] ?? []) : [];
  const pick = heights.filter((h) => h >= height).sort((a, b) => a - b)[0];
  return pick === 720 || pick === 540 ? pageCopyUrl(mediaId, pick) : null;
}

/**
 * The file a video is loaded ahead as (output/Preloader.tsx; a22-review-fadecopies S4): the one its playback will
 * take, so the copy is warm and no full-size decoder is started for nothing. A background video takes this page's copy
 * as a playback does; anything else, the original.
 */
export function preloadVideoUrl(mediaId: string, attempt: number, background: boolean): string {
  return (background ? pageCopyFor(mediaId, attempt) : null) ?? mediaUrl(mediaId, attempt);
}
