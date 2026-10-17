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
/** In step: within two frames (at 30 a second) of the clock. */
const IN_STEP = 2 / 30;
/** A file still out of step once it has played on after landing is aimed again at once, so many times in a row. */
const REAIMS = 2;
/**
 * Further off than this (four frames at 30 a second) on two checks in a row while it plays on, long after it
 * landed, a file is aimed again too, within REAIMS (Sessions 31–36): a stall on a busy computer, CI's Mac's
 * looping video 0.23 s behind a moment after it went round, was left to its rate, 4 s to make up.
 */
const DRIFTED = 4 / 30;

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
  // A file takes a moment more to play on after landing (a sound most): how far off its last jump still
  // was once it played on, learned so a clip looping every few seconds keeps step (pictures too, Sessions
  // 31–36: a video's first loop, aimed by nothing learned yet, came round 0.16 s late).
  let settleLead = 0;
  let settleFrom = 0;
  // Its start, once it plays (Sessions 31–36): a moment later, where it plays says whether it began in step
  // (a busy computer's sound device starts late). Not learned from: a jump lands as jumps do.
  let startFrom = 0;
  // How many times in a row it has been aimed again, out of step once it played on.
  let reaims = 0;
  // How many checks in a row have found it more than DRIFTED off while it played on.
  let drifted = 0;
  const lead = () => seekLead + settleLead;
  // How long a seek takes to land, and a sound to settle, are lengths of time on this computer (each video
  // aims its next jump by them); where a video should be is always the engine's time (clock()).
  const jump = (to: number) => {
    // eslint-disable-next-line no-restricted-properties -- a length of time: when this seek began, to see how long it takes to land
    seekFrom = performance.now();
    v.currentTime = to + lead();
  };
  const landed = () => {
    if (seekFrom > 0) {
      // eslint-disable-next-line no-restricted-properties -- a length of time: how long the seek took to land
      seekLead = Math.min(0.5, (performance.now() - seekFrom) / 1000);
      // eslint-disable-next-line no-restricted-properties -- a length of time: when it began to settle after its jump
      settleFrom = performance.now();
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
  const onPlaying = () => {
    // eslint-disable-next-line no-restricted-properties -- a length of time: when it began to play
    if (seekFrom === 0 && settleFrom === 0) startFrom = performance.now();
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
    // eslint-disable-next-line no-restricted-syntax -- stops at a clip's end point when its own position reaches it; check() holds it there by the engine's time too
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
    // eslint-disable-next-line no-restricted-properties -- a length of time: how long it has played on since it landed or began
    const now = performance.now();
    // Once it has played on a moment after landing (or before it jumps again): where it plays says how much
    // further (or less far) to aim next time; after its start, whether it began in step. Still out of step
    // then, it is aimed again at once (Sessions 31–36): catching up at 2% a second, a sound 0.3 s behind
    // took 12 s, and a busy computer's never did.
    let measured: number | null = null;
    const playingOn = seekFrom === 0 && settleFrom === 0 && startFrom === 0;
    drifted = playingOn && !correction.seek && Math.abs(offset) > DRIFTED ? drifted + 1 : 0;
    if (settleFrom > 0 && (correction.seek || now - settleFrom >= SETTLE_MS)) {
      settleFrom = 0;
      settleLead = Math.min(0.5 - seekLead, Math.max(-seekLead, settleLead - offset));
      measured = offset;
    }
    if (startFrom > 0 && (correction.seek || now - startFrom >= SETTLE_MS)) {
      startFrom = 0;
      measured = offset;
    }
    let reaim = false;
    if (measured !== null && !correction.seek) {
      reaim = Math.abs(measured) > IN_STEP && reaims < REAIMS;
      reaims = reaim ? reaims + 1 : 0;
    } else if (drifted >= 2 && reaims < REAIMS) {
      reaim = true;
      reaims++;
      drifted = 0;
    }
    // Aiming ahead past the end of a loop wraps round to its start.
    if (correction.seek || reaim)
      jump(c.loop && span > 0 ? start + ((at - start + lead()) % span) - lead() : at);
    else if (v.playbackRate !== correction.rate) v.playbackRate = correction.rate;
    // A loop goes round by a jump, aimed as every jump is, from where the clock is, a moment before its end
    // (Sessions 31–36): left to the element's own loop, a whole file came round late, a picture 0.08 s and a
    // sound 0.2 to 0.3 s on a Mac, so a looping video's sound fell further behind each time round.
    if (c.loop && span > 0 && !wrap) {
      const left = end - v.currentTime;
      if (left < CHECK_MS / 1000 + 0.05)
        // eslint-disable-next-line no-restricted-syntax -- sends a loop round when its own position reaches its end; check() keeps it in step by the engine's time too
        wrap = setTimeout(
          () => {
            wrap = null;
            const round = clock();
            const bounds = playbackBounds(round.clip, v.duration);
            const length = bounds.end - bounds.start;
            if (!round.loop || length <= 0) return;
            const there = playbackPosition(round, v.duration, engineNow());
            jump(bounds.start + ((there - bounds.start + lead()) % length) - lead());
          },
          Math.max(0, ((left - HOLD_EARLY) / v.playbackRate) * 1000),
        );
    }
    armHold();
  };
  v.muted = !audible;
  v.addEventListener('playing', onPlaying, { once: true });
  v.addEventListener('loadedmetadata', onMetadata, { once: true });
  v.addEventListener('error', failed);
  v.addEventListener('seeked', landed);
  for (const event of ['seeked', 'playing', 'ratechange']) v.addEventListener(event, rearm);
  // eslint-disable-next-line no-restricted-syntax -- checks every 250 ms that the video is where the engine's time says (check)
  const timer = setInterval(check, CHECK_MS);
  v.src = mediaUrl(mediaId, attempt);
  const stop = () => {
    clearInterval(timer);
    if (wrap) clearTimeout(wrap);
    if (hold) clearTimeout(hold);
    v.removeEventListener('loadedmetadata', onMetadata);
    v.removeEventListener('playing', onPlaying);
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
