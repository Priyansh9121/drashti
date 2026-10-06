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
/** How long after a sound lands before where it plays says how well the jump was aimed. */
const SETTLE_MS = 300;
/** Held at an end point: further from it than this (one frame at 60 Hz), it is put exactly there. */
const HOLD_TOLERANCE = 1 / 60;
/** How far before an end point (seconds) the stop is aimed, half a frame. */
const HOLD_EARLY = 0.008;

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
  let hold: ReturnType<typeof setTimeout> | null = null;
  // How long the last jump took to land: the next one aims that far ahead, so it lands in step.
  let seekLead = 0;
  let seekFrom = 0;
  // A sound takes a moment more to start again after landing (pictures play on at once): how far
  // off its last jump still was once it played on, learned so a clip looping every few seconds keeps step.
  let settleLead = 0;
  let settleFrom = 0;
  const lead = () => seekLead + settleLead;
  const jump = (to: number) => {
    seekFrom = performance.now();
    v.currentTime = to + lead();
  };
  const landed = () => {
    if (seekFrom > 0) {
      seekLead = Math.min(0.5, (performance.now() - seekFrom) / 1000);
      if (audible) settleFrom = performance.now();
    }
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
  /** Played once, an end point before the file's own end (seconds); null when it loops or plays to the end. */
  const endPoint = (c: ReturnType<typeof clock>): number | null => {
    if (c.loop) return null;
    const { end } = playbackBounds(c.clip, v.duration);
    return end < v.duration - 0.01 ? end : null;
  };
  /** Held at its end point: paused there, exactly (within a frame). */
  const holdAt = (end: number) => {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - end) > HOLD_TOLERANCE) v.currentTime = end;
  };
  /**
   * Played once to an end point: stopped the moment the element itself gets there, timed from where
   * it plays and how fast, not at the next check (up to a quarter of a second past it). Aimed a
   * little early, so a timer that comes late still stops it within two frames.
   */
  const armHold = () => {
    if (hold || v.paused || v.seeking) return;
    const end = endPoint(clock());
    if (end === null) return;
    const left = (end - v.currentTime) / (v.playbackRate || 1);
    if (left > CHECK_MS / 1000 + 0.05) return;
    hold = setTimeout(
      () => {
        hold = null;
        const point = endPoint(clock());
        if (point === null || v.paused || v.seeking) return;
        // Not there yet (it stalled a moment): aim again from where it is.
        if ((point - v.currentTime) / (v.playbackRate || 1) > HOLD_EARLY * 1.5) armHold();
        else holdAt(point);
      },
      Math.max(0, (left - HOLD_EARLY) * 1000),
    );
  };
  /** A jump, a new speed or playing again: the stop is timed afresh. */
  const rearm = () => {
    if (hold) clearTimeout(hold);
    hold = null;
    armHold();
  };
  const check = () => {
    if (!framed || v.seeking || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const c = clock();
    const at = playbackPosition(c, v.duration, engineNow());
    const { start, end } = playbackBounds(c.clip, v.duration);
    const point = endPoint(c);
    // An end point is held once the clock gets there, or once the element has (a moment ahead of the
    // clock, which is near it).
    if (
      point !== null &&
      (at >= point - 0.01 ||
        (v.paused && v.currentTime >= point - HOLD_TOLERANCE && at >= point - limits.jumpOver))
    ) {
      holdAt(point);
      return;
    }
    // Played once to its end: the file's own end comes by itself (it plays on to it and holds its last
    // frame, even a moment behind the clock).
    if (!c.loop && at >= end - 0.01) return;
    if (v.paused && !v.ended) void v.play().catch(() => undefined);
    const span = end - start;
    const offset = playbackOffset(v.currentTime, at, span, c.loop);
    const correction = playbackCorrection(offset, limits);
    // A sound's last jump, once it has played on a moment (or before it jumps again): where it plays
    // says how much further (or less far) to aim next time.
    if (settleFrom > 0 && (correction.seek || performance.now() - settleFrom >= SETTLE_MS)) {
      settleFrom = 0;
      settleLead = Math.min(0.5 - seekLead, Math.max(-seekLead, settleLead - offset));
    }
    // Aiming ahead past the end of a loop wraps round to its start.
    if (correction.seek) jump(c.loop && span > 0 ? start + ((at - start + lead()) % span) - lead() : at);
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
    armHold();
  };
  v.muted = !audible;
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  v.addEventListener('seeked', landed);
  for (const event of ['seeked', 'playing', 'ratechange']) v.addEventListener(event, rearm);
  const timer = setInterval(check, CHECK_MS);
  v.src = mediaUrl(mediaId, attempt);
  const stop = () => {
    clearInterval(timer);
    if (wrap) clearTimeout(wrap);
    if (hold) clearTimeout(hold);
    v.removeEventListener('loadedmetadata', onMetadata);
    v.removeEventListener('error', failed);
    v.removeEventListener('loadeddata', frame);
    v.removeEventListener('seeked', whenFrame);
    v.removeEventListener('seeked', landed);
    for (const event of ['seeked', 'playing', 'ratechange']) v.removeEventListener(event, rearm);
    // Let go of the file and the decoder now, not when the element is collected.
    v.pause();
    v.removeAttribute('src');
    v.load();
  };
  return Object.assign(stop, {
    resync: () => {
      if (wrap) clearTimeout(wrap);
      if (hold) clearTimeout(hold);
      wrap = null;
      hold = null;
      check();
    },
  });
}
