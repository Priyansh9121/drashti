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
   * points, and a jump to a marker (or the time bar's move, paused or not:
   * Session 54). Left out: the element's own loop, the whole file.
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
    return { startedAt, loop: t ? t.loop : v.loop, clip: t?.clip, seek: later(t?.seek, t?.clip) };
  };
  // A start still to come (Session 54, C2): a deck's video or sound a moment after its click, a step's hold once its
  // clip is over. It waits at its point, paused, every screen alike, until the engine's time gets there, and is
  // checked again just then (until then it played at once, and was pulled back at every check).
  let starting: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const later = (
    seek: PlaybackSeek | undefined,
    clip: PlaybackClip | undefined,
  ): PlaybackSeek | undefined => {
    const at = seek ? seek.at : startedAt;
    if (seek?.paused || at <= engineNow()) return seek;
    if (starting?.at !== at) {
      if (starting) clearTimeout(starting.timer);
      // eslint-disable-next-line no-restricted-syntax -- never decides a frame: asks for a check when the engine's time reaches its start (check() plays it from where the clock says)
      const timer = setTimeout(
        () => {
          starting = null;
          check();
        },
        Math.max(0, at - engineNow()),
      );
      starting = { at, timer };
    }
    return { at, toMs: seek ? seek.toMs : (clip?.startMs ?? 0), paused: true };
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
  // How far ahead the last jump was aimed (Session 52): that, less how far off it is once it has played on, is
  // the lead the jump needed (the seek's own time and the rest).
  let aimed = 0;
  // Its start, once it plays (Sessions 31–36): a moment later, where it plays says whether it began in step
  // (a busy computer's sound device starts late). Not learned from: a jump lands as jumps do.
  let startFrom = 0;
  // How many times in a row it has been aimed again, out of step once it played on.
  let reaims = 0;
  // A file the engine has sent somewhere new (Session 51: resync(); pictures too since 52), not yet checked.
  let sent = false;
  const lead = () => seekLead + settleLead;
  // How long a seek takes to land, and a sound to settle, are lengths of time on this computer (each video
  // aims its next jump by them); where a video should be is always the engine's time (clock()).
  const jump = (to: number) => {
    // eslint-disable-next-line no-restricted-properties -- a length of time: when this seek began, to see how long it takes to land
    seekFrom = performance.now();
    aimed = lead();
    v.currentTime = to + aimed;
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
    // A file that has already played to its end (or end point) holds its last frame, and one the time bar has paused
    // (Session 54) waits where it is: neither plays.
    const c = clock();
    if (!c.seek?.paused && (c.loop || at < playbackBounds(c.clip, v.duration).end))
      void v.play().catch(() => undefined);
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
    const moved = sent;
    sent = false;
    const c = clock();
    const at = playbackPosition(c, v.duration, engineNow());
    // Paused by the time bar (Session 54): held where it waits, exactly, as at an end point, every screen and the
    // audio player alike, until Play sends it on from there (a jump, landing as every jump does).
    if (c.seek?.paused) {
      if (wrap) clearTimeout(wrap);
      wrap = null;
      holdAt(at);
      return;
    }
    const { start, end } = playbackBounds(c.clip, v.duration);
    const point = endPoint(c);
    // An end point is held once the clock gets there, or once the element has (a moment ahead of the
    // clock, which is near it). Not a file the engine has just sent back from there (Session 51: a sound a
    // marker sent 0.3 s before it was held, silent while the clock played that last stretch; a screen's
    // picture, frozen, until Session 52): it plays it, from a jump.
    if (
      point !== null &&
      (at >= point - 0.01 ||
        (!moved && v.paused && v.currentTime >= point - HOLD_TOLERANCE && at >= point - limits.jumpOver))
    ) {
      holdAt(point);
      return;
    }
    // Played once to its end: the file's own end comes by itself (it plays on to it and holds its last
    // frame, even a moment behind the clock). A jump there (Session 50: Forward 15 s, Last 10 s on a short
    // file) puts it there at once, holding it, rather than playing on to it.
    if (!c.loop && at >= end - 0.01) {
      if (end - v.currentTime > limits.jumpOver) holdAt(end);
      return;
    }
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
    if (settleFrom > 0 && (correction.seek || now - settleFrom >= SETTLE_MS)) {
      settleFrom = 0;
      // The lead that jump needed: what it was aimed with, less how far off it played on. The seek's own time is
      // learned as it lands; the rest is how long it takes to play on. Worked out from the lead it had before, as
      // if this seek had taken as long as the last (until Session 52), a first jump, aimed by nothing learned yet,
      // learned its seek's time twice: aimed again, it landed about as far ahead as it had landed behind (0.09 s
      // with seeks of 0.1 s), and a start put right that way used up its re-aims there.
      settleLead = Math.min(0.5, Math.max(0, aimed - offset)) - seekLead;
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
    } else if (moved && !correction.seek && Math.abs(offset) > IN_STEP) {
      // Sent a little way (Session 51), less than the half second that makes a sound jump: it lands there by a
      // jump too, measured as every landing is, not eased at 2% a second (0.3 s took 15 s). A picture less than
      // its quarter of a second alike (Session 52: 0.2 s took 4 s at 5%).
      reaim = true;
    }
    // Aiming ahead past the end of a loop wraps round to its start.
    if (correction.seek || reaim)
      jump(c.loop && span > 0 ? start + ((at - start + lead()) % span) - lead() : at);
    else if (v.playbackRate !== correction.rate) v.playbackRate = correction.rate;
    // Paused where the clock says it plays: it plays on, once any jump is made (Session 51). Held at its own end
    // (`ended`), play() would start it again from the top, so one taken back from there (Back 15 s, a marker) used
    // to wait for the next check, up to a quarter of a second late and at a different moment on each screen; now
    // it plays from where it lands, at once. One that got to its end a moment before the clock (no jump) waits.
    if (v.paused && !v.ended) void v.play().catch(() => undefined);
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
            if (!round.loop || length <= 0 || round.seek?.paused) return;
            const there = playbackPosition(round, v.duration, engineNow());
            // A new time round may be aimed again as a start may: whatever the landings before it used up
            // (CI's Mac: a sound landed 0.2 s off just after two aimed again, and was left to its 2%).
            reaims = 0;
            jump(bounds.start + ((there - bounds.start + lead()) % length) - lead());
            // Held up past the file's own end (a busy moment) with its own loop off (start and end points), it had
            // stopped there: it plays on from where it lands at once (Session 51), not frozen (and silent) until
            // the next check, up to a quarter of a second.
            if (v.paused) void v.play().catch(() => undefined);
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
    if (starting) clearTimeout(starting.timer);
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
      if (framed) {
        // A file the engine has sent somewhere new (Session 51: a skip, a jump to a marker; or new start or end
        // points while it plays) lands there by a jump, however short (check()), and may be aimed again, as a
        // start and each time round a loop may, whatever the landings before it used up. A landing or a start
        // not yet measured, or a seek still landing, is not measured: from the new place it would seem 15 or
        // 30 s off. On CI's Windows, skips pressed that quickly taught the sound a lead at its 0.5 s cap, and
        // with its re-aims used up just before, Forward 15 s landed 0.4 s ahead and was eased back at 2% a
        // second. A screen's picture alike since Session 52, every screen the same: it landed up to 0.45 s
        // ahead for up to a quarter of a second, or a seek's time behind, easing back. Before its first frame
        // nothing is aimed again here: its start is aimed by the clock and measured as a start is
        // (BackgroundMedia.tsx's and SlideView.tsx's videos ask as they mount).
        seekFrom = 0;
        settleFrom = 0;
        startFrom = 0;
        reaims = 0;
        sent = true;
      }
      check();
    },
  });
}
