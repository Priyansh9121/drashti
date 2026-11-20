import { MEDIA_SCHEME } from './media';

/*
 * A live-stream link on the screens (alpha.20, the playback set's slice 8; the owner's Q60-34 "all VLC type features",
 * Q60-35 "B, all in 20", Q60-39 "Yes, all A", P3 A). Tools › Show a Stream Link… (Pro Mode) takes an HLS link (one
 * that ends in .m3u8) or a YouTube live link, RECEIVED only: Drashti never sends anything there. The main process's own
 * FFmpeg copies it, never re-encoding, into a short local stream in Drashti's own folder, which this computer's
 * audience screens play as they play a video, with its sound in the hall at the Video level. If it drops, the screens
 * hold its last picture while Drashti reconnects by itself; after 20 seconds the Wallpaper goes up, and when the link
 * comes back it plays again by itself, so long as nothing else went up meanwhile. Drashti's own stream never carries
 * it: the stream shows the Wallpaper, with none of its sound, while one is up. Output nodes show nothing of it and
 * phones its name, as for Show a Window…. What the operator window and the main process say to each other about it.
 */

/** HLS (a .m3u8 link) or a YouTube live stream's page. */
export type StreamLinkKind = 'hls' | 'youtube';

export type StreamLinkCheck =
  { ok: true; kind: StreamLinkKind; url: string; host: string } | { ok: false; message: string };

/** What the window says a link must be. */
export const STREAM_LINK_KINDS =
  'Paste an HLS link (one that ends in .m3u8) or a YouTube live stream’s link. Drashti only receives it: nothing is ever sent there.';

/**
 * Check a pasted link: a YouTube video's link (as YouTube's Share button gives it: youtu.be/…, youtube.com/watch?v=…,
 * /live/…), or an http or https link to an HLS playlist (its path ends in .m3u8). Anything else, a name and password in
 * the link, or another kind of address (rtmp, a file) is refused, in plain words. The link checked is the one Drashti
 * uses: whatever else a YouTube link names is left out.
 */
export function checkStreamLink(_raw: string): StreamLinkCheck {
  // Red (x54): not built yet.
  return { ok: false, message: '' };
}

/** What a stream link is called on the operator's notices, a stage screen and a phone: where it comes from. */
export const streamLinkName = (_check: { kind: StreamLinkKind; host: string }): string => '';

/**
 * How the stream link stands, for the operator: off (none up, none coming); connecting (asked for, not up yet);
 * playing (up, its pictures coming); reconnecting (up, its last picture held while Drashti reconnects); wallpaper (it
 * dropped for 20 seconds: the Wallpaper is up, and it comes back by itself when the link does, unless something else
 * goes up); ended (it stopped for good: the stream finished, or the link no longer plays).
 */
export type StreamLinkState = 'off' | 'connecting' | 'playing' | 'reconnecting' | 'wallpaper' | 'ended';

export interface StreamLinkStatus {
  state: StreamLinkState;
  /** Its name (streamLinkName), null while off. */
  name: string | null;
  /** When it went into this state (ms since the epoch, the main process's clock): how long it has been so. */
  since: number | null;
  /** Why it is waiting, or why it ended, in plain words; null when there is nothing to say. */
  note: string | null;
}

export const STREAM_LINK_OFF: StreamLinkStatus = { state: 'off', name: null, since: null, note: null };

export type StreamLinkResult = { ok: true } | { ok: false; message: string };

/** How long a link may stay dropped, its last picture held, before the Wallpaper goes up (P3 A: 20 seconds). */
export const STREAM_LINK_WALLPAPER_MS = 20_000;

/**
 * Where a screen (or the audio player) plays a stream link's local stream, joined at segment `segment`
 * (src/main/media/media-protocol.ts serves it: a playlist that starts there, so Chromium's player starts there).
 */
export const streamLinkUrl = (linkId: string, segment: number): string =>
  `${MEDIA_SCHEME}://live/${linkId}/${String(segment)}/index.m3u8`;

/**
 * Where a page joins a stream link (alpha.20, slice 8): its player starts at segment `segment` (its first frame), and
 * shows that frame from `startAt` (the engine's time), so every screen and the hall's sound show the same moment at
 * the same time. Chromium's player for a live stream cannot seek, and each player's own time starts at 0 at its first
 * segment (x54's probe), so this is how they are kept together: the same start, then speed alone.
 */
export interface StreamLinkJoin {
  segment: number;
  startAt: number;
}
