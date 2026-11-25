/*
 * This page's choice of a video's page copy (QA23-FADE-9 candidate 1; src/main/media/page-copies.ts). A page that
 * draws its videos smaller than they are says so once (the stream's picture page at its preset's height, the operator
 * window at 540p); the hall's screens never do, and play every original. A background video's playback asks here as
 * it starts (render/playback.ts, `pageCopy`): the smallest copy ready at or above this page's height, else the
 * original. Never below it, and never instead of a file a playback already has.
 */

/** This page's drawn height for its videos, or null (the hall's screens, and every page that never says). */
export function setPageCopyHeight(_height: number | null): void {
  // Nothing yet.
}

/** The copies Main has ready, by media id (media:page-copies and its changes). */
export function setReadyPageCopies(_ready: Record<string, number[]>): void {
  // Nothing yet.
}

/** The copy a playback starting now takes, or null for the original. */
export function pageCopyFor(_mediaId: string, _attempt = 0): string | null {
  return null;
}
