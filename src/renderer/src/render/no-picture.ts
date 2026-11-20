import type { DrashtiBridge } from '../../../shared/bridge';
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

/** A media element's error in words for the log: its MediaError code's meaning, then Chromium's own message. */
export function errorKind(error: PlaybackError): string {
  const kinds: Record<number, string> = {
    1: 'stopped',
    2: 'a network or file error',
    3: 'a decoding error',
    4: 'not playable here',
  };
  const kind = kinds[error.code] ?? 'an error with no code';
  return error.message === '' ? kind : `${kind}: ${error.message}`;
}

/** The showings (and tries of each) this page has said could not play. */
const failedTold = new Set<string>();

/**
 * Say that this showing of a video (its file, when it went up, and which try at loading it) could not play here
 * (Q60-31: its element failed, as this computer's decoder raises an error, or a cut or damaged file does), with the
 * error's kind: Main takes it off with its sound, unless a GPU process stopped then (its videos load again by
 * themselves), and says so by its name and where. Once a showing and try; phones' pages have no bridge.
 */
export function tellCannotPlay(
  mediaId: string,
  startedAt: number,
  attempt: number,
  error: PlaybackError,
): void {
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  const key = `${mediaId}@${String(startedAt)}#${String(attempt)}`;
  if (!bridge?.media?.cannotPlay || failedTold.has(key)) return;
  failedTold.add(key);
  void bridge.media.cannotPlay(mediaId, startedAt, errorKind(error)).catch(() => undefined);
}
