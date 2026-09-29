import { mediaUrl, playbackCorrection, playbackOffset, playbackPosition } from '../../../shared/media';

export interface PlaybackOptions {
  mediaId: string;
  /** When the playback started (ms since the epoch, main-process clock). */
  startedAt: number;
  /** The file has its first frame (or sound), at the right point. */
  onFrame?: () => void;
  /** The file cannot be loaded or played. */
  onError?: () => void;
  /** Sound: the audio player plays it; every other window keeps media muted (the default). */
  audible?: boolean;
  /** How much the speed may change to catch up (default 5%; less for sound). */
  maxRateChange?: number;
}

/** How often a playing file is checked against the shared clock. */
const CHECK_MS = 250;

/**
 * Play a library file in a media element, starting where a playback that
 * began at `startedAt` is now, and keeping it there: every window follows
 * the same clock, so outputs stay in step with each other and with the
 * sound, and a window that opens late (or reloads) joins at the right point.
 * Looping follows the element's `loop`. Returns a function that stops it and
 * lets go of the file.
 */
export function startPlayback(v: HTMLMediaElement, options: PlaybackOptions): () => void {
  const { mediaId, startedAt, onFrame, onError, audible = false, maxRateChange } = options;
  let framed = false;
  const expected = () => playbackPosition({ startedAt, loop: v.loop }, v.duration, Date.now());
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
    const at = expected();
    if (at > 0.05) {
      v.addEventListener('seeked', whenFrame, { once: true });
      v.currentTime = at;
    } else whenFrame();
    // A file that has already played to its end holds its last frame.
    if (v.loop || at < v.duration) void v.play().catch(() => undefined);
  };
  const check = () => {
    if (!framed || v.seeking || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const at = expected();
    if (!v.loop && at >= v.duration) return;
    if (v.paused && !v.ended) void v.play().catch(() => undefined);
    const correction = playbackCorrection(
      playbackOffset(v.currentTime, at, v.duration, v.loop),
      maxRateChange,
    );
    if (correction.seek) v.currentTime = at;
    else if (v.playbackRate !== correction.rate) v.playbackRate = correction.rate;
  };
  v.muted = !audible;
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  const timer = setInterval(check, CHECK_MS);
  v.src = mediaUrl(mediaId);
  return () => {
    clearInterval(timer);
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
