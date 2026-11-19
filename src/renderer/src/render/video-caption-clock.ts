/** A video's own decoded/presented clock. No elapsed-time timer is used for captions. */
export function watchVideoClock(
  video: HTMLVideoElement,
  changed: (sourceMs: number | null) => void,
): () => void {
  let live = true;
  let handle = 0;
  const read = (seconds = video.currentTime) => {
    if (live)
      changed(
        video.readyState < 2 || video.seeking || video.ended || !Number.isFinite(seconds)
          ? null
          : seconds * 1000,
      );
  };
  const event = () => read();
  const frame: VideoFrameRequestCallback = (_now, metadata) => {
    if (!live) return;
    read(metadata.mediaTime);
    handle = video.requestVideoFrameCallback(frame);
  };
  const events = [
    'loadeddata',
    'timeupdate',
    'pause',
    'playing',
    'seeking',
    'seeked',
    'ended',
    'emptied',
    'error',
  ];
  for (const name of events) video.addEventListener(name, event);
  read();
  if (typeof video.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(frame);
  return () => {
    live = false;
    for (const name of events) video.removeEventListener(name, event);
    if (handle) video.cancelVideoFrameCallback(handle);
  };
}
