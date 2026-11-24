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
  // The decoder's first frame is in, but the compositor does not hold it yet: it is read as it is presented.
  let readWhenPresented = false;
  /**
   * The decoder's actual PTS of the frame the element holds now: a trim can lie between source frames, so no frame rate
   * is assumed. 'later' where Chromium has no frame for the element yet (InvalidStateError: on a loaded computer its
   * loadeddata can come before the compositor has that frame, a21-s5b-1123-124303-84026); 'failed' for anything else.
   */
  const read = (): 'read' | 'later' | 'failed' => {
    try {
      const frame = new VideoFrame(video);
      try {
        decoded = frame.timestamp;
      } finally {
        frame.close();
      }
      return 'read';
    } catch (error) {
      return error instanceof DOMException && error.name === 'InvalidStateError' ? 'later' : 'failed';
    }
  };
  const fail = () => {
    stop();
    failed?.();
  };
  /** The frame read is the one presented, to the microsecond (no frame rate assumed). */
  const matches = () =>
    decoded !== null && presented !== null && Math.abs(presented * 1_000_000 - decoded) <= 1;
  const release = () => {
    if (stopped || finished || video.seeking || !matches()) return;
    finished = true;
    ready();
  };
  const onPresented: VideoFrameRequestCallback = (_now, frame) => {
    callback = 0;
    if (stopped) return;
    presented = frame.mediaTime;
    if (readWhenPresented) {
      readWhenPresented = false;
      // Presented now, so the compositor holds it: a refusal now is a real one.
      if (read() !== 'read') {
        fail();
        return;
      }
    } else if (decoded !== null && !matches() && read() === 'failed') {
      // Read again as another frame is presented: the frame read at the decoder's word can still be the file's
      // start, from before the trim seek's frame reached the compositor (a22-cue-1124-113329-24953, CI's Mac: LIVE's
      // read never matched the trimmed frame presented after it, and the cue failed). Only a forbidden read fails it.
      fail();
      return;
    }
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
      const result = read();
      if (result === 'read') release();
      else if (result === 'later') readWhenPresented = true;
      else fail();
    },
    stop,
  };
}
