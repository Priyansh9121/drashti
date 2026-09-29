import { mediaUrl, playbackPosition } from '../../../shared/media';

export interface PlaybackOptions {
  mediaId: string;
  /** When the playback started (ms since the epoch, main-process clock). */
  startedAt: number;
  /** The video has its first frame, at the right point. */
  onFrame?: () => void;
  /** The file cannot be loaded or played. */
  onError?: () => void;
}

/**
 * Play a library video in an element, muted (sound comes from one place,
 * never from every screen), starting where a playback that began at
 * `startedAt` is now, so a window that opens late shows the same frame as the
 * others. Looping follows the element's `loop`. Returns a function that stops
 * it and lets go of the file.
 */
export function startPlayback(v: HTMLVideoElement, options: PlaybackOptions): () => void {
  const { mediaId, startedAt, onFrame, onError } = options;
  let framed = false;
  const frame = () => {
    if (framed) return;
    framed = true;
    onFrame?.();
  };
  const failed = () => {
    onError?.();
  };
  const whenFrame = () => {
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) frame();
    else v.addEventListener('loadeddata', frame, { once: true });
  };
  const onMetadata = () => {
    const at = playbackPosition({ startedAt, loop: v.loop }, v.duration, Date.now());
    if (at > 0.05) {
      v.addEventListener('seeked', whenFrame, { once: true });
      v.currentTime = at;
    } else whenFrame();
    // A video that has already played to its end holds its last frame.
    if (v.loop || at < v.duration) void v.play().catch(() => undefined);
  };
  v.muted = true;
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  v.src = mediaUrl(mediaId);
  return () => {
    v.removeEventListener('loadedmetadata', onMetadata);
    v.removeEventListener('error', failed);
    v.removeEventListener('loadeddata', frame);
    v.removeEventListener('seeked', whenFrame);
    // Let go of the file and the decoder now, not when the element is collected.
    v.pause();
    v.removeAttribute('src');
    v.load();
  };
}
