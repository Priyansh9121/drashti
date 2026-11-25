import type { MediaInfo } from '../convert/plan';

/*
 * Page copies (QA23-FADE-9, candidate 1; lead 2, answered by lead, owner away): a smaller copy of a video for a page
 * that draws it smaller than it is, so that page decodes no more than it shows. The stream's picture page takes a copy
 * at its preset's height (720p for the weak preset), the operator window (LIVE and its other previews) a 540p one; the
 * hall's screens always play the original. On CI's two-core Windows a crossfade has six 1080p software decodes at once
 * (two on each of the hall, LIVE and the stream page) and every page's decoding waits for a core
 * (a22-fadeprep-1125-134233-68030).
 *
 * A copy is kept beside the library's media, in Media/page-copies, named by its source's sha256 and its height
 * (`<sha256>-720p.webm`), so it belongs to exactly those bytes. It keeps the source's timeline exactly: every frame at
 * the same time, the same keyframes, the same length, and the source's own sound packets, copied (the stream page's
 * pictures are clocked by their own sound). It is used only if it is there when a showing starts, and never in place
 * of one mid-showing. It is deleted only with its source, or when its source's bytes change: nothing else.
 */

export const PAGE_COPIES_DIR = 'page-copies';
/** The heights a page copy is made at: the stream's weak preset, and the operator window's previews. */
export const PAGE_COPY_HEIGHTS = [720, 540] as const;
export type PageCopyHeight = (typeof PAGE_COPY_HEIGHTS)[number];

export interface PageCopyPlan {
  width: number;
  height: PageCopyHeight;
  ext: 'webm' | 'mp4';
}

/** The copy a source can have at a height: none for a video not taller than it, a still, or one this can't keep exact. */
export function pageCopyPlan(_info: MediaInfo, _height: PageCopyHeight): PageCopyPlan | null {
  return null;
}

/** A copy's file name: its source's sha256 and its height. */
export function pageCopyName(sha256: string, height: PageCopyHeight, ext: 'webm' | 'mp4'): string {
  return `${sha256}-${String(height)}p.${ext}`;
}

/** FFmpeg's arguments for a copy written to `tmp`: the source's timeline kept exactly, only the picture smaller. */
export function pageCopyArgs(_source: string, _tmp: string, _info: MediaInfo, _plan: PageCopyPlan): string[] {
  return [];
}

/** The copies in the folder, by their source's sha256 (each with its heights). Any other file is not a copy. */
export async function pageCopiesIn(_mediaDir: string): Promise<Map<string, PageCopyHeight[]>> {
  return Promise.resolve(new Map());
}

/**
 * Deletes the copies whose source is gone or changed: those named by a sha256 no media row has now. Only files named
 * exactly as copies are in the folder are looked at; nothing else is ever touched. Says which it deleted.
 */
export async function sweepPageCopies(_mediaDir: string, _liveShas: ReadonlySet<string>): Promise<string[]> {
  return Promise.resolve([]);
}

/** Deletes one source's copies, as its own file goes (media-removal.ts). */
export async function removePageCopiesOf(_mediaDir: string, _sha256: string): Promise<void> {
  return Promise.resolve();
}
