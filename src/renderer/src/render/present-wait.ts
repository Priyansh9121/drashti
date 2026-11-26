/*
 * A background video drawn over the picture before (render/BackgroundMedia.tsx, alpha.20): its data is in, and the
 * picture before (another background, the Wallpaper or black-out's cover: render/Scene.tsx) stays under it until
 * Chromium has presented a frame of it on the screen, so the picture before goes only then, never leaving the hall a
 * black frame between (CI x54-1121-023510-80364: shown the moment its data was in, it was not yet presented).
 */

/** How long a video drawn over the picture before waits for its first presented frame before it is taken as ready. */
export const PRESENT_WAIT_MS = 300;

/** What the wait reads of the video element. */
export type PresentingVideo = Pick<
  HTMLVideoElement,
  'requestVideoFrameCallback' | 'cancelVideoFrameCallback'
>;

/**
 * Wait for the video's first presented frame, then say so (`presented`, once). A frame callback that does not come (a
 * paused video presents no new frame) is not waited on long. The wait, to stop as the slot changes.
 */
export function untilPresented(video: PresentingVideo, presented: () => void): () => void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    presented();
  };
  const callback = video.requestVideoFrameCallback(once);
  // eslint-disable-next-line no-restricted-syntax -- only stops waiting for a frame callback: what shows is decided by the slots
  const fallback = setTimeout(once, PRESENT_WAIT_MS);
  return () => {
    done = true;
    video.cancelVideoFrameCallback(callback);
    clearTimeout(fallback);
  };
}
