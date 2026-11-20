import type { DrashtiBridge } from '../../../shared/bridge';
import { NO_FIRST_FRAME } from '../../../shared/no-picture';
import type { PlaybackError } from './playback';

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

/** The showings (and tries of each) this page has said could not play. */
const failedTold = new Set<string>();

/**
 * Say that this showing of a video (its file, when it went up, and which try at loading it) could not play here
 * (Q60-31: its element failed, as this computer's decoder raises an error, or a cut or damaged file does), with the
 * element's error (its MediaError code and Chromium's words, for Main's log): Main takes it off with its sound, unless a GPU process stopped then (its videos load again by
 * themselves), and says so by its name and where. Once a showing and try; phones' pages have no bridge.
 */
export function tellCannotPlay(
  mediaId: string,
  startedAt: number,
  attempt: number,
  error: PlaybackError,
): void {
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  // A first frame that never came is said once, and an error after it still is (Q60-44).
  const key = `${mediaId}@${String(startedAt)}#${String(attempt)}${error.code === NO_FIRST_FRAME ? '/no-frame' : ''}`;
  if (!bridge?.media?.cannotPlay || failedTold.has(key)) return;
  failedTold.add(key);
  void bridge.media.cannotPlay(mediaId, startedAt, error.code, error.message).catch(() => undefined);
}
