/** Below half a channel step even for black over white: private pixels still quantize to the current picture. */
export const PRIVATE_VIDEO_OPACITY = 1 / 1024;

/** A decoded private frame is ready only once Chromium has actually submitted that trimmed frame. */
export function cuePresentation(
  video: HTMLVideoElement,
  ready: () => void,
  failed?: () => void,
): {
  decoded(): void;
  stop(): void;
} {
  let decoded: number | null = null;
  let presented: number | null = null;
  let finished = false;
  let stopped = false;
  let callback = 0;
  const release = () => {
    if (
      stopped ||
      finished ||
      decoded === null ||
      presented === null ||
      video.seeking ||
      Math.abs(presented * 1_000_000 - decoded) > 1
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
  const stop = () => {
    stopped = true;
    if (callback) video.cancelVideoFrameCallback(callback);
  };
  return {
    decoded: () => {
      if (stopped || finished) return;
      try {
        // A trim can lie between source frames: use the decoder's actual PTS, not an assumed frame rate.
        const frame = new VideoFrame(video);
        try {
          decoded = frame.timestamp;
        } finally {
          frame.close();
        }
        release();
      } catch {
        stop();
        failed?.();
      }
    },
    stop,
  };
}
