/** Below half a channel step even for black over white: private pixels still quantize to the current picture. */
export const PRIVATE_VIDEO_OPACITY = 1 / 1024;

/**
 * How long a held cue waits, its trim seek landed and its frame read, while the frame presented is still another one
 * (the file's start, from before that seek) and nothing new is presented, before it asks once more for its frame.
 */
export const STALE_FRAME_MS = 500;

/**
 * Where that one more seek goes: this far past the held place (s). Chromium skips a seek to a paused video's own place
 * (WebMediaPlayerImpl::DoSeek: no new frame), so it lands 2 µs on, in the same trimmed frame; a frame starting within
 * those 2 µs would show for under 2 µs at playback.
 */
export const RESEEK_STEP_S = 0.000_002;

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
  // Its trim seek landed and its frame was read, but another frame is still the one presented, with nothing new
  // (a22-cue-1125-175229-57052, CI's Windows hall: the file's start presented during the seek, then nothing for 20 s):
  // after STALE_FRAME_MS it seeks once more to the same frame, at most once a cue.
  let staleWait: ReturnType<typeof setTimeout> | null = null;
  let reseeked = false;
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
    if (staleWait) clearTimeout(staleWait);
    ready();
  };
  /** The decoder's word: its frame read now, or as it is presented. */
  const decodedNow = () => {
    const result = read();
    if (result === 'read') release();
    else if (result === 'later') readWhenPresented = true;
    else fail();
  };
  const onReseeked = () => {
    video.removeEventListener('seeked', onReseeked);
    if (!stopped && !finished) decodedNow();
  };
  /** Waits again from now, while the frame presented is not the one read. */
  const waitIfStale = () => {
    if (staleWait) clearTimeout(staleWait);
    staleWait = null;
    if (reseeked || stopped || finished || decoded === null || presented === null || matches()) return;
    // eslint-disable-next-line no-restricted-syntax -- decides no frame: only when a held cue asks again for the frame it holds
    staleWait = setTimeout(() => {
      staleWait = null;
      // A seek landing now (playback's own) brings its own frame; a video playing on (after its Go) is not held.
      if (stopped || finished || video.seeking || matches()) return;
      if (!video.paused && video.playbackRate !== 0) return;
      reseeked = true;
      video.addEventListener('seeked', onReseeked);
      video.currentTime += RESEEK_STEP_S;
    }, STALE_FRAME_MS);
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
    if (!finished) {
      callback = video.requestVideoFrameCallback(onPresented);
      waitIfStale();
    }
  };
  callback = video.requestVideoFrameCallback(onPresented);
  const stop = () => {
    stopped = true;
    if (callback) video.cancelVideoFrameCallback(callback);
    if (staleWait) clearTimeout(staleWait);
    video.removeEventListener('seeked', onReseeked);
  };
  return {
    decoded: () => {
      if (stopped || finished) return;
      decodedNow();
      waitIfStale();
    },
    stop,
  };
}
