import type { DrashtiBridge } from '../../../shared/bridge';
import type { CorrectionLimits, PlaybackClip, PlaybackSeek } from '../../../shared/media';
import {
  mediaUrl,
  PICTURE_LIMITS,
  playbackBounds,
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
  /**
   * How it plays now (Session 14), read at every check so a change lands
   * without loading the file again: whether it loops, its start and end
   * points, and a jump to a marker. Left out: the element's own loop, the
   * whole file.
   */
  timing?: () => { loop: boolean; clip?: PlaybackClip; seek?: PlaybackSeek };
}

/** A playback: call it to stop; resync() checks it against the clock at once (after a jump). */
export type Playback = (() => void) & { resync: () => void };

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

export function startPlayback(v: HTMLMediaElement, options: PlaybackOptions): Playback {
  const { mediaId, attempt, startedAt, onFrame, onError, audible = false, limits = PICTURE_LIMITS } = options;
  /** How it plays now: a loop between start and end points is done here, not by the element. */
  const clock = () => {
    const t = options.timing?.();
    if (t?.clip && v.loop) v.loop = false;
    return { startedAt, loop: t ? t.loop : v.loop, clip: t?.clip, seek: t?.seek };
  };
  let wrap: ReturnType<typeof setTimeout> | null = null;
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
  const expected = () => playbackPosition(clock(), v.duration, engineNow());
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
    // A file that has already played to its end (or end point) holds its last frame.
    const c = clock();
    if (c.loop || at < playbackBounds(c.clip, v.duration).end) void v.play().catch(() => undefined);
  };
  const check = () => {
    if (!framed || v.seeking || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const c = clock();
    const at = playbackPosition(c, v.duration, engineNow());
    const { start, end } = playbackBounds(c.clip, v.duration);
    // At its end point it holds there (its last frame), as at the end of the file.
    if (!c.loop && at >= end - 0.01) {
      if (!v.paused) v.pause();
      if (c.clip && Math.abs(v.currentTime - end) > 0.1) v.currentTime = end;
      return;
    }
    if (v.paused && !v.ended) void v.play().catch(() => undefined);
    const span = end - start;
    const correction = playbackCorrection(playbackOffset(v.currentTime, at, span, c.loop), limits);
    // Aiming ahead past the end of a loop wraps round to its start.
    if (correction.seek) jump(c.loop && span > 0 ? start + ((at - start + seekLead) % span) - seekLead : at);
    else if (v.playbackRate !== correction.rate) v.playbackRate = correction.rate;
    // A loop between start and end points: back to the start the moment it reaches the end point.
    if (c.loop && c.clip && !wrap) {
      const left = end - v.currentTime;
      if (left < CHECK_MS / 1000 + 0.05)
        wrap = setTimeout(
          () => {
            wrap = null;
            jump(start);
          },
          Math.max(0, (left / v.playbackRate) * 1000),
        );
    }
  };
  v.muted = !audible;
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  v.addEventListener('seeked', landed);
  const timer = setInterval(check, CHECK_MS);
  v.src = mediaUrl(mediaId, attempt);
  const stop = () => {
    clearInterval(timer);
    if (wrap) clearTimeout(wrap);
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
  return Object.assign(stop, {
    resync: () => {
      if (wrap) clearTimeout(wrap);
      wrap = null;
      check();
    },
  });
}
