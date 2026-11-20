import type { DrashtiBridge } from '../../../shared/bridge';
import { type StreamLinkJoin, streamLinkUrl } from '../../../shared/live-link';
import { engineNow } from './clock';

/*
 * A stream link's local stream played in a media element (alpha.20, the playback set's slice 8): a screen's picture
 * (render/LinkView.tsx) or the hall's sound (audio/main.ts). Chromium's player for a live stream cannot seek, and each
 * player's own time starts at 0 at its first segment, three from its playlist's end as it loads (x54's probe), so pages
 * that loaded a moment apart would show the stream up to a segment apart: the hall's sound off the speakers' lips, two
 * screens side by side apart. So each page joins it as the main process says (src/main/live-link/: the segment its
 * player starts at, given a playlist that starts there, and the moment, by the engine's time, that segment's first
 * frame is shown), holds that first frame until then, and plays from then at normal speed: Chromium's player for a live
 * stream gives up at any other speed (CI x54-1120-210932-7783: every player set to play 5% faster failed, "source not
 * supported", and none at normal speed did). Every page joined at one showing starts at the same moment on the same
 * frame, and the pages run on one clock. One ahead (a clock moved) waits a moment, paused, until the engine's time comes
 * to it; one far behind with pictures to play (it loaded late, or stalled alone) asks to join again; while the link
 * itself has stopped, nothing is changed: its last frame stays, and the main process starts every page again together
 * when it comes back.
 */

/** How often it is looked at against the engine's time. */
const CHECK_MS = 250;
/** Ahead by more than this, it waits there (a picture's, the hall's sound's: a sound's wait is heard sooner). */
const AHEAD_S = { picture: 0.1, sound: 0.08 } as const;
/** Behind by more than this, playing a while with pictures to play: it joins again. */
const BEHIND_S = { picture: 0.5, sound: 0.4 } as const;
/** How soon a page asks again to join a link that is not up yet (its local stream starting, or starting again). */
const ASK_AGAIN_MS = 1000;

export interface LivePlaybackOptions {
  linkId: string;
  /** The hall's sound (the audio player): every other page plays it muted. */
  audible: boolean;
  /** Its first frame is in, playing (presented, for a picture). */
  onFrame?: () => void;
  /** Far behind with pictures to play: the caller joins it again (a new element, the old one kept until then). */
  onBehind?: () => void;
  /** Its player gave up (an error). */
  onError?: () => void;
}

/** How long a player plays before it may be found far behind (a start that came late catches up first). */
const SETTLE_MS = 3000;
/** Its time this far on from where it was first played: it plays (a frame or two). */
const MOVED_S = 0.04;

/** Play a stream link in `el` (see above). Returns its stop, which lets go of the stream and the decoder. */
export function startLivePlayback(el: HTMLMediaElement, options: LivePlaybackOptions): () => void {
  const bridge = (globalThis as { drashti?: DrashtiBridge }).drashti;
  let on = true;
  let joined: StreamLinkJoin | null = null;
  let framed = false;
  let behind = false;
  /** When it was first played (the engine's time), or null while its first frame is held. */
  let playedAt: number | null = null;
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
    // For the tests and Save Diagnostics: where this player joined, and when its first frame is shown.
    el.dataset['segment'] = String(got.segment);
    el.dataset['startAt'] = String(got.startAt);
    el.src = streamLinkUrl(options.linkId, got.segment);
    el.load();
  };
  /**
   * Its first frame is in, playing: told once its time has moved on from where it started (a player never played may
   * draw nothing, x54-1120-195548-69004; and a picture not yet shown is never presented, so no frame callback comes for
   * it, x54-1120-202541-81657: its time is what says it plays).
   */
  const frameIn = () => {
    if (framed || !on) return;
    framed = true;
    // For the tests and Save Diagnostics: it plays.
    el.dataset['moved'] = '1';
    options.onFrame?.();
  };
  /** Where its time stood as it was first played. */
  let playedFrom = 0;
  const play = () => {
    void el.play().catch(() => undefined);
    if (playedAt !== null) return;
    playedAt = engineNow();
    playedFrom = el.currentTime;
    // For the tests and Save Diagnostics: when it was first played (the engine's time).
    el.dataset['played'] = String(Math.round(playedAt));
  };
  const check = () => {
    const j = joined;
    if (!on || !j || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const now = engineNow();
    const expected = (now - j.startAt) / 1000;
    // For the tests and Save Diagnostics: where it is against where the engine's time has it.
    el.dataset['offset'] = (el.currentTime - expected).toFixed(3);
    // Its moment still to come: its first frame held until then.
    if (expected < 0) {
      if (!el.paused) el.pause();
      later(-expected * 1000, check);
      return;
    }
    const offset = el.currentTime - expected;
    const kind = options.audible ? 'sound' : 'picture';
    // Ahead (a clock moved, or its own ran fast): it waits there until the engine's time comes to it.
    if (offset > AHEAD_S[kind]) {
      if (!el.paused) el.pause();
      later(offset * 1000, check);
      return;
    }
    // Its moment has come (late or not): it plays, at normal speed always (see above).
    if (el.paused) {
      play();
      return;
    }
    // Stopped for want of pictures (the link itself stopped): left as it is, its last frame shown.
    if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    // Playing a while and still behind, with pictures to play (it loaded late, or stalled alone): it joins again.
    if (offset < -BEHIND_S[kind] && playedAt !== null && now - playedAt >= SETTLE_MS && !behind) {
      behind = true;
      options.onBehind?.();
    }
  };
  const failed = () => {
    options.onError?.();
  };
  // Its time moving on, played: its first frame is in (see frameIn).
  const moved = () => {
    if (!framed && playedAt !== null && !el.paused && el.currentTime > playedFrom + MOVED_S) frameIn();
  };
  // For the tests and Save Diagnostics: what happened to it, in order (the last few).
  const note = (event: Event) => {
    const was = (el.dataset['events'] ?? '').split(' ').filter((e) => e !== '');
    el.dataset['events'] = [...was, event.type].slice(-8).join(' ');
  };
  for (const name of ['loadeddata', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'emptied'])
    el.addEventListener(name, note);
  el.addEventListener('loadeddata', check);
  el.addEventListener('timeupdate', moved);
  el.addEventListener('error', failed);
  // eslint-disable-next-line no-restricted-syntax -- checks every 250 ms that it is where the engine's time says (check)
  const timer = setInterval(check, CHECK_MS);
  void ask();
  return () => {
    on = false;
    clearInterval(timer);
    if (wait) clearTimeout(wait);
    for (const name of ['loadeddata', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'emptied'])
      el.removeEventListener(name, note);
    el.removeEventListener('loadeddata', check);
    el.removeEventListener('timeupdate', moved);
    el.removeEventListener('error', failed);
    el.pause();
    el.removeAttribute('src');
    el.load();
  };
}
