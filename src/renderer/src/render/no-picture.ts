import type { DrashtiBridge } from '../../../shared/bridge';

/*
 * A video whose picture this computer cannot draw (Session 60, x36; shared/no-picture.ts): Chromium plays such a file as
 * sound only, with no error, its element loaded at 0 × 0. Found as the file loads, in the background's video
 * (BackgroundMedia.tsx: never shown as ready, so the picture before it stays) and a slide's or the box's
 * (SlideView.tsx), and said to the main process, once a showing, which takes it off with its sound and converts it.
 * Phones' pages have no bridge: they say nothing (they draw a still picture of it anyway).
 */

/** Whether a video element that has its file's details has no picture to draw. */
export const hasNoPicture = (v: HTMLVideoElement): boolean =>
  v.readyState >= HTMLMediaElement.HAVE_METADATA && v.videoWidth === 0 && v.videoHeight === 0;

/** The showings this page has said it cannot draw. */
const told = new Set<string>();

/** Say that this showing of a video (its file and when it went up) cannot be drawn here. */
export function tellNoPicture(mediaId: string, startedAt: number): void {
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  const key = `${mediaId}@${String(startedAt)}`;
  if (!bridge?.media?.noPicture || told.has(key)) return;
  told.add(key);
  void bridge.media.noPicture(mediaId, startedAt).catch(() => undefined);
}
