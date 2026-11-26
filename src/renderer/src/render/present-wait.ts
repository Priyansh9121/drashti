/*
 * A background video drawn over the picture before (render/BackgroundMedia.tsx, alpha.20): its data is in, and the
 * picture before (another background, the Wallpaper or black-out's cover: render/Scene.tsx) stays under it until
 * Chromium has presented a frame of it on the screen, so the picture before goes only then, never leaving the hall a
 * black frame between (CI x54-1121-023510-80364: shown the moment its data was in, it was not yet presented).
 *
 * Never with nothing of its own to show (alpha.24, the owner's "never black"): until then a timer let the picture
 * before go PRESENT_WAIT_MS after the video was drawn over it, whatever the video was doing. On CI's Mac
 * (a22-cuelive-1127-024127-21311, video-cue-cost.spec.ts:104) the stream page drew nothing for 222 ms while the new
 * video, playing but stalled, was sent on by its check's catch-up seek: the timer took the picture before away mid-seek,
 * with no frame of the new video presented, and the stream was black until the seek landed. Now the timer is only for
 * a video that holds still (its frame drawn already, no new one to come by itself); a video that plays waits for its
 * first presented frame, with the slot's no-first-frame watch as the end of that wait, so the picture before is never
 * kept for ever either.
 */

/** How long a video that holds still, drawn over the picture before, is waited on before it is taken as ready. */
export const PRESENT_WAIT_MS = 300;

/** HTMLMediaElement.HAVE_CURRENT_DATA: it has a frame at the place it is. */
const HAVE_CURRENT_DATA = 2;

/** What the wait reads of the video element. */
export type PresentingVideo = Pick<
  HTMLVideoElement,
  | 'requestVideoFrameCallback'
  | 'cancelVideoFrameCallback'
  | 'paused'
  | 'ended'
  | 'seeking'
  | 'playbackRate'
  | 'readyState'
  | 'addEventListener'
  | 'removeEventListener'
>;

/**
 * What ends a wait for a frame that never comes: given the wait's end, it calls it when it gives up, later (never as it
 * starts: the slot's no-first-frame watch, render/no-picture.ts watchStart, gives up at one of its looks), and returns
 * its own stop.
 */
export type EndOfWait = (end: () => void) => () => void;

/** After these a video may hold still (paused, at its end, held at rate 0), or have its frame where it is again. */
const STILL_EVENTS = ['pause', 'ended', 'ratechange', 'seeked', 'loadeddata', 'canplay'] as const;

/**
 * Whether the video holds still with a frame of it drawn: paused or at its end (a paused video presents no new frame),
 * or held at rate 0 (a cue's Go lead, render/playback.ts), at a place it has a frame for, no seek landing. A video
 * seeking, or with no frame where it is, has nothing new drawn yet: its seek's frame is waited for.
 */
const holdsStill = (video: PresentingVideo): boolean =>
  (video.paused || video.ended || video.playbackRate === 0) &&
  !video.seeking &&
  video.readyState >= HAVE_CURRENT_DATA;

/**
 * Wait for the video's first presented frame, then say so (`presented`, once). A video that holds still presents no new
 * frame, so it is not waited on long: PRESENT_WAIT_MS, while it still holds still. One that plays (or seeks) is
 * waited on until a frame of it is presented, or until `endOfWait` gives up. The wait, to stop as the slot changes.
 */
export function untilPresented(
  video: PresentingVideo,
  presented: () => void,
  endOfWait: EndOfWait,
): () => void {
  let done = false;
  let still: ReturnType<typeof setTimeout> | null = null;
  const listening = new AbortController();
  let stopWatch: (() => void) | null = null;
  let callback = 0;
  const stop = () => {
    done = true;
    video.cancelVideoFrameCallback(callback);
    if (still !== null) clearTimeout(still);
    still = null;
    listening.abort();
    stopWatch?.();
  };
  const finish = () => {
    if (done) return;
    stop();
    presented();
  };
  /** Holding still now: let go after PRESENT_WAIT_MS, if it still does then (played or sent on meanwhile, it waits on). */
  const holding = () => {
    if (done || still !== null || !holdsStill(video)) return;
    // eslint-disable-next-line no-restricted-syntax -- only stops waiting for a frame callback of a video that holds still: what shows is decided by the slots
    still = setTimeout(() => {
      still = null;
      if (holdsStill(video)) finish();
    }, PRESENT_WAIT_MS);
  };
  callback = video.requestVideoFrameCallback(finish);
  for (const event of STILL_EVENTS) video.addEventListener(event, holding, { signal: listening.signal });
  holding();
  stopWatch = endOfWait(finish);
  return stop;
}
