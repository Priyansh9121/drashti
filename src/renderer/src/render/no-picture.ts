import type { DrashtiBridge } from '../../../shared/bridge';
import {
  NO_FIRST_FRAME,
  NO_START_IN_TIME,
  startVerdict,
  startWatch,
  startWatched,
} from '../../../shared/no-picture';
import { engineNow } from './clock';
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

/** The showings this page has said could not play, until it draws them after all (tellPlaysHere). */
const saidFailing = new Set<string>();

/**
 * A showing this page said could not play has its first frame after all (alpha.23, a22-halldrop's review, MUST-2: a slow
 * or stalled one that loaded later, one loaded again after a GPU process stopped): said to Main once, which no longer
 * names this screen for it under LIVE. Nothing drawn changes. Phones' pages have no bridge.
 */
export function tellPlaysHere(mediaId: string, startedAt: number): void {
  const key = `${mediaId}@${String(startedAt)}`;
  if (!saidFailing.delete(key)) return;
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  if (!bridge?.media?.playsHere) return;
  void bridge.media.playsHere(mediaId, startedAt).catch(() => undefined);
}

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
  const key = `${mediaId}@${String(startedAt)}#${String(attempt)}${
    error.code === NO_FIRST_FRAME ? '/no-frame' : error.code === NO_START_IN_TIME ? '/slow' : ''
  }`;
  if (!bridge?.media?.cannotPlay || failedTold.has(key)) return;
  failedTold.add(key);
  saidFailing.add(`${mediaId}@${String(startedAt)}`);
  void bridge.media.cannotPlay(mediaId, startedAt, error.code, error.message).catch(() => undefined);
}

/**
 * A video on a slide, a prop or in the picture-in-picture box (render/SlideView.tsx SlideVideo; x46's item 4 of
 * Q60-31): with no first frame within FIRST_FRAME_MS (Q60-44), said to Main as a background's is (its element's error
 * is said by its onError, tellCannotPlay). Only said: the element keeps loading, and its first frame, should it come
 * after this page said it could not play (on this try or an earlier one), is said too (tellPlaysHere). The watch, to
 * stop as it goes.
 */
export function watchFirstFrame(
  v: HTMLVideoElement,
  mediaId: string,
  startedAt: number,
  attempt: number,
): () => void {
  if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    tellPlaysHere(mediaId, startedAt);
    return () => undefined;
  }
  // Its first frame, whenever it comes while it is up: after the watch's word too.
  const drawing = new AbortController();
  v.addEventListener(
    'loadeddata',
    () => {
      tellPlaysHere(mediaId, startedAt);
    },
    { signal: drawing.signal, once: true },
  );
  const listening = new AbortController();
  const stopWatch = watchStart(v, mediaId, (verdict, seen) => {
    listening.abort();
    tellCannotPlay(mediaId, startedAt, attempt, {
      code: verdict === 'slow' ? NO_START_IN_TIME : NO_FIRST_FRAME,
      message: seen,
    });
  });
  const stop = () => {
    stopWatch();
    listening.abort();
  };
  v.addEventListener('loadeddata', stop, { signal: listening.signal });
  v.addEventListener('error', stop, { signal: listening.signal });
  return () => {
    stop();
    drawing.abort();
  };
}

/** How often a page looks at a video's start (ms). */
const START_LOOK_MS = 500;

/** The end of what a video has buffered (ms into its file). */
function bufferedEndMs(v: HTMLVideoElement): number {
  const b = v.buffered;
  return b.length > 0 ? b.end(b.length - 1) * 1000 : 0;
}

/** Frames a video has decoded (Chromium's count; 0 where the page cannot tell). */
function decodedFrames(v: HTMLVideoElement): number {
  const chromium = (v as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
  return typeof chromium === 'number' ? chromium : 0;
}

/**
 * Watch a video's start until its first frame (Q60-51, the owner's "Yes, A"; shared/no-picture.ts startVerdict): every
 * half second, how much it has loaded and decoded and how ready it is, its own 'progress' events, and how much of its
 * file Main has sent (on CI's Mac a slow file told the page nothing else: x47-1120-205802-554); said once: 'stalled'
 * (no progress for FIRST_FRAME_MS: it cannot play, as before) or 'slow' (still loading or decoding with no first frame by
 * SLOW_START_MS: it could not start in time). Stop it when the first frame comes or it fails.
 */
export function watchStart(
  v: HTMLVideoElement,
  mediaId: string,
  said: (verdict: 'stalled' | 'slow', seen: string) => void,
): () => void {
  let watch = startWatch(engineNow());
  let looked = 0;
  let answers = 0;
  let progressEvents = 0;
  const onProgress = () => {
    progressEvents++;
  };
  v.addEventListener('progress', onProgress);
  // What Main has sent of the file, asked at each look (phones' pages have no bridge: 0, as they cannot ask).
  const bridge = (globalThis as { drashti?: Partial<DrashtiBridge> }).drashti;
  let served = 0;
  const askServed = () => {
    if (!bridge?.media) return;
    void bridge.media
      .served(mediaId)
      .then((bytes) => {
        answers++;
        if (typeof bytes === 'number' && bytes > served) served = bytes;
      })
      .catch(() => undefined);
  };
  askServed();
  // eslint-disable-next-line no-restricted-syntax -- decides no frame: only whether a video that never drew is said to fail
  const looks = setInterval(() => {
    const at = engineNow();
    watch = startWatched(watch, {
      at,
      loadedMs: bufferedEndMs(v),
      readyState: v.readyState,
      decoded: decodedFrames(v),
      progressEvents,
      served,
    });
    looked++;
    askServed();
    const verdict = startVerdict(watch, at);
    if (verdict === 'wait') return;
    stop();
    // What it saw, for the log and Save Diagnostics (Main logs it with the video's kind; never shown to anyone).
    const last = watch.last;
    const seen = `${String(looked)} looks over ${((at - watch.since) / 1000).toFixed(1)} s, the last progress ${(
      (at - watch.lastProgress) /
      1000
    ).toFixed(1)} s ago; loaded ${String(Math.round(last?.loadedMs ?? 0))} ms, ready state ${String(
      last?.readyState ?? 0,
    )}, ${String(last?.decoded ?? 0)} decoded, ${String(last?.progressEvents ?? 0)} progress, ${String(
      last?.served ?? 0,
    )} bytes sent (${String(answers)} answers)`;
    said(verdict, seen);
  }, START_LOOK_MS);
  const stop = () => {
    clearInterval(looks);
    v.removeEventListener('progress', onProgress);
  };
  return stop;
}
