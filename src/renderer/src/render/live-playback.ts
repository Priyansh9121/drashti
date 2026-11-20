import type { DrashtiBridge } from '../../../shared/bridge';
import { type StreamLinkJoin, streamLinkUrl } from '../../../shared/live-link';
import type { CorrectionLimits } from '../../../shared/media';
import { engineNow } from './clock';

/*
 * A stream link's local stream played in a media element (alpha.20, the playback set's slice 8): a screen's picture
 * (render/LinkView.tsx) or the hall's sound (audio/main.ts). Chromium's player for a live stream cannot seek, and each
 * player's own time starts at 0 at its first segment, three from its playlist's end as it loads (x54's probe), so pages
 * that loaded a moment apart would show the stream up to a segment apart: the hall's sound off the speakers' lips, two
 * screens side by side apart. So each page joins it as the main process says (src/main/live-link/: the segment its
 * player starts at, given a playlist that starts there, and the moment, by the engine's time, that segment's first
 * frame is shown), holds that first frame until then, and from then on is kept on the engine's time by speed alone, as
 * a file is between jumps (shared/media.ts's limits). Every page joined at one showing starts at the same moment on the
 * same frame. One far behind with pictures to play (it loaded late, or stalled alone) asks to join again; while the
 * link itself has stopped, nothing is changed: its last frame stays, and the main process starts every page again
 * together when it comes back.
 */

/** How often it is looked at against the engine's time. */
const CHECK_MS = 250;
/** Behind by more than this, with pictures to play: it joins again. */
const REJOIN_BEHIND_S = 1.5;
/** How soon a page asks again to join a link that is not up yet (its local stream starting, or starting again). */
const ASK_AGAIN_MS = 1000;
/** Closer than this to its place, it plays at normal speed. */
const IN_STEP_S = 0.012;

export interface LivePlaybackOptions {
  linkId: string;
  /** The hall's sound (the audio player): every other page plays it muted. */
  audible: boolean;
  limits: CorrectionLimits;
  /** Its first frame is in (held or playing). */
  onFrame?: () => void;
  /** Far behind with pictures to play: the caller joins it again (a new element, the old one kept until then). */
  onBehind?: () => void;
  /** Its player gave up (an error). */
  onError?: () => void;
}

/** Play a stream link in `el` (see above). Returns its stop, which lets go of the stream and the decoder. */
export function startLivePlayback(el: HTMLMediaElement, options: LivePlaybackOptions): () => void {
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  let on = true;
  let joined: StreamLinkJoin | null = null;
  let framed = false;
  let behind = false;
  let wait: ReturnType<typeof setTimeout> | null = null;
  el.muted = !options.audible;
  el.autoplay = false;
  el.preload = 'auto';
  const later = (ms: number, then: () => void) => {
    if (wait) clearTimeout(wait);
    // eslint-disable-next-line no-restricted-syntax -- only asks for a look again: what shows is decided from the engine's time (check)
    wait = setTimeout(then, Math.max(0, ms));
  };
  const ask = async () => {
    const got = (await bridge?.liveLink.join(options.linkId).catch(() => null)) ?? null;
    if (!on) return;
    if (!got) {
      later(ASK_AGAIN_MS, () => void ask());
      return;
    }
    joined = got;
    el.src = streamLinkUrl(options.linkId, got.segment);
    el.load();
  };
  const check = () => {
    const j = joined;
    if (!on || !j || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const expected = (engineNow() - j.startAt) / 1000;
    // Its moment still to come: its first frame held until then.
    if (expected < 0) {
      if (!el.paused) el.pause();
      later(-expected * 1000, check);
      return;
    }
    const offset = el.currentTime - expected;
    // Ahead (a clock moved): it waits there until the engine's time comes to it.
    if (offset > options.limits.jumpOver) {
      if (!el.paused) el.pause();
      later(offset * 1000, check);
      return;
    }
    // Stopped for want of pictures (the link itself stopped): left as it is, its last frame shown.
    if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !el.paused) return;
    if (offset < -REJOIN_BEHIND_S && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      if (!behind) {
        behind = true;
        options.onBehind?.();
      }
      return;
    }
    const change = Math.max(
      -options.limits.maxRateChange,
      Math.min(options.limits.maxRateChange, -offset * 2),
    );
    const rate = Math.abs(offset) < IN_STEP_S ? 1 : 1 + change;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (el.paused) void el.play().catch(() => undefined);
  };
  const loaded = () => {
    if (!framed) {
      framed = true;
      options.onFrame?.();
    }
    check();
  };
  const failed = () => {
    options.onError?.();
  };
  el.addEventListener('loadeddata', loaded);
  el.addEventListener('error', failed);
  // eslint-disable-next-line no-restricted-syntax -- checks every 250 ms that it is where the engine's time says (check)
  const timer = setInterval(check, CHECK_MS);
  void ask();
  return () => {
    on = false;
    clearInterval(timer);
    if (wait) clearTimeout(wait);
    el.removeEventListener('loadeddata', loaded);
    el.removeEventListener('error', failed);
    el.pause();
    el.removeAttribute('src');
    el.load();
  };
}
