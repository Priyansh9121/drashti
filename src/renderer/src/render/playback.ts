import type { DrashtiBridge } from '../../../shared/bridge';
import type { CorrectionLimits } from '../../../shared/media';
import {
  mediaUrl,
  PICTURE_LIMITS,
  playbackCorrection,
  playbackOffset,
  playbackPosition,
} from '../../../shared/media';
import { engineNow } from './clock';

export interface PlaybackOptions {
  mediaId: string;
  /** A later try at loading it (a node's copy that landed after the first try failed). */
  attempt?: number;
  /** When the playback started (ms since the epoch, main-process clock). */
  startedAt: number;
  /** The file has its first frame (or sound), at the right point. */
  onFrame?: () => void;
  /** The file cannot be loaded or played. */
  onError?: () => void;
  /** Sound: the audio player plays it; every other window keeps media muted (the default). */
  audible?: boolean;
  /** When to jump, and how much the speed may change to catch up (pictures by default). */
  limits?: CorrectionLimits;
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
/** Files whose length this page has told the main process (once each). */
const toldLength = new Set<string>();

/**
 * Tell the main process how long a file is, once per page: a stage screen
 * shows the time left on the background video or the sound (only the
 * outputs' and the audio player's reports are kept).
 */
function tellLength(mediaId: string, seconds: number): void {
  // Phones' pages draw with this renderer too, and have no bridge.
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  if (!bridge || !Number.isFinite(seconds) || seconds <= 0 || toldLength.has(mediaId)) return;
  toldLength.add(mediaId);
  void bridge.media.reportLength(mediaId, Math.round(seconds * 1000)).catch(() => undefined);
}

export function startPlayback(v: HTMLMediaElement, options: PlaybackOptions): () => void {
  const { mediaId, attempt, startedAt, onFrame, onError, audible = false, limits = PICTURE_LIMITS } = options;
  // How long the last jump took to land: the next one aims that far ahead, so it lands in step.
  let seekLead = 0;
  let seekFrom = 0;
  const jump = (to: number) => {
    seekFrom = performance.now();
    v.currentTime = to + seekLead;
  };
  const landed = () => {
    if (seekFrom > 0) seekLead = Math.min(0.5, (performance.now() - seekFrom) / 1000);
    seekFrom = 0;
  };
  let framed = false;
  const expected = () => playbackPosition({ startedAt, loop: v.loop }, v.duration, engineNow());
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
    tellLength(mediaId, v.duration);
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
    const correction = playbackCorrection(playbackOffset(v.currentTime, at, v.duration, v.loop), limits);
    // Aiming ahead past the end of a looping file wraps round to its start.
    if (correction.seek) jump(v.loop ? ((at + seekLead) % v.duration) - seekLead : at);
    else if (v.playbackRate !== correction.rate) v.playbackRate = correction.rate;
  };
  v.muted = !audible;
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  v.addEventListener('seeked', landed);
  const timer = setInterval(check, CHECK_MS);
  v.src = mediaUrl(mediaId, attempt);
  return () => {
    clearInterval(timer);
    v.removeEventListener('loadedmetadata', onMetadata);
    v.removeEventListener('error', failed);
    v.removeEventListener('loadeddata', frame);
    v.removeEventListener('seeked', whenFrame);
    v.removeEventListener('seeked', landed);
    // Let go of the file and the decoder now, not when the element is collected.
    v.pause();
    v.removeAttribute('src');
    v.load();
  };
}
