/** Below half a channel step even for black over white: private pixels still quantize to the current picture. */
export const PRIVATE_VIDEO_OPACITY = 1 / 1024;

/** A decoded private frame is ready only once Chromium has actually submitted that trimmed frame. */
export function cuePresentation(
  video: HTMLVideoElement,
  ready: () => void,
): {
  decoded(): void;
  stop(): void;
} {
  let decoded = false;
  let presented: number | null = null;
  let finished = false;
  let stopped = false;
  let callback = 0;
  const release = () => {
    if (
      stopped ||
      finished ||
      !decoded ||
      presented === null ||
      video.seeking ||
      Math.abs(presented - video.currentTime) >= 1 / 30
    )
      return;
    finished = true;
    ready();
  };
  const onPresented: VideoFrameRequestCallback = (_now, frame) => {
    callback = 0;
    if (stopped) return;
    presented = frame.mediaTime;
    release();
    if (!finished) callback = video.requestVideoFrameCallback(onPresented);
  };
  callback = video.requestVideoFrameCallback(onPresented);
  return {
    decoded: () => {
      decoded = true;
      release();
    },
    stop: () => {
      stopped = true;
      if (callback) video.cancelVideoFrameCallback(callback);
    },
  };
}
