import type { Authority } from '../network/outbound-policy';
import { join } from 'node:path';

/*
 * The main process's FFmpeg for a stream link (alpha.20, the playback set's slice 8): it receives the link's HLS and
 * copies it, never re-encoding (no picture or sound is decoded: little work), into a short local HLS of MPEG-TS
 * segments in Drashti's own folder, which this computer's screens play through drashti-media:// (src/main/media/
 * media-protocol.ts) with Chromium's own HLS player. The x47 probe (CI x47-1120-155022-14901) found that player plays
 * MPEG-TS segments on both systems and fragmented MP4 segments on the Mac only, so the copy is always MPEG-TS.
 *
 * What it may open is the web only (http, https and what they run on): never a file, a pipe or a device, whatever a
 * playlist names. It starts near live (a few segments from a live playlist's end), keeps about eight segments on disk
 * (deleting older ones), and, started again after a drop, carries the same local playlist on (its numbering, and a
 * discontinuity where the gap was), so the screens' players carry on too.
 */

/** The local stream's own names, in its folder: the playlist and its numbered segments. */
export const LOCAL_PLAYLIST = 'index.m3u8';
export const LOCAL_SEGMENT = /^seg-\d{6}\.ts$/u;
const SEGMENT_PATTERN = 'seg-%06d.ts';

/** The protocols FFmpeg may use for the link and everything its playlists name (HLS's encrypted segments too). */
export const RELAY_PROTOCOLS = 'http,https,tcp,tls,crypto';

interface RelayPolicy {
  authority: Authority;
  guard: boolean;
}
const checkedInputs = new WeakMap<string[], RelayPolicy>();
/** Only the trusted playlist reader can authorize a relay input. */
export const relayPolicy = (args: string[]): RelayPolicy | null => checkedInputs.get(args) ?? null;

export interface RelayInput {
  authority?: Authority;
  guard?: boolean;
  /** The playlist to receive: a master playlist (with `program`) or a media playlist. */
  url: string;
  /** A master playlist's variant to take (FFmpeg's program for it: its place in the master); null for a media playlist. */
  program: number | null;
  /** Where the local stream is written. */
  dir: string;
  /** Started again after a drop: the local playlist carries on. */
  again: boolean;
  /** The user agent to ask with (YouTube's streams ask for the one yt-dlp used); null for FFmpeg's own. */
  userAgent?: string | null;
}

export function relayArgs(input: RelayInput): string[] {
  const p = input.program;
  const args = [
    ...['-hide_banner', '-loglevel', 'error', '-nostdin'],
    // Only the web, for the link and anything its playlists name.
    ...['-protocol_whitelist', RELAY_PROTOCOLS],
    // A short glitch is ridden out: the connection made again, a segment asked for again, a stalled read given up.
    ...['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1'],
    ...['-reconnect_delay_max', '4', '-rw_timeout', '10000000', '-seg_max_retry', '3'],
    ...(input.userAgent ? ['-user_agent', input.userAgent] : []),
    // Near live: a live playlist's last few segments, never its start.
    ...['-live_start_index', '-3'],
    ...['-i', input.url],
    // The picture (it must have one) and its sound, if it has any; of a master playlist, the variant chosen.
    ...['-map', p === null ? '0:v:0' : `0:p:${String(p)}:v:0`],
    ...['-map', p === null ? '0:a:0?' : `0:p:${String(p)}:a:0?`],
    // Copied as it comes: no picture or sound is decoded or encoded.
    ...['-c', 'copy'],
    ...['-f', 'hls', '-hls_time', '1', '-hls_list_size', '8', '-hls_delete_threshold', '2'],
    ...[
      '-hls_flags',
      `delete_segments+independent_segments+omit_endlist+temp_file${input.again ? '+append_list+discont_start' : ''}`,
    ],
    ...['-hls_segment_filename', join(input.dir, SEGMENT_PATTERN)],
    join(input.dir, LOCAL_PLAYLIST),
  ];
  if (input.authority) checkedInputs.set(args, { authority: input.authority, guard: input.guard === true });
  return args;
}
