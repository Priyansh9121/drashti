import type { CommandResult } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import { STREAM_LINK_OFF, type StreamLinkResult, type StreamLinkStatus } from '../../shared/live-link';
import type { PlaylistFetch } from './fetch-playlist';

/* Red (x54, slice 8): Show a Stream Link…'s main-process side: not built yet. */

export interface RelayRun {
  done: Promise<{ code: number | null }>;
  stop(): void;
}

/** How far a local stream has got: its newest segment's number (null: none yet), its segments' length, each listed. */
export interface LocalProgress {
  newest: number | null;
  targetSeconds: number | null;
  /** The segments its playlist lists now, in order, each with its length (seconds). */
  segments: { n: number; seconds: number }[];
}

export interface LiveLinkDeps {
  /** Start the relay FFmpeg with these arguments (below normal priority); null when Drashti's FFmpeg is missing. */
  startRelay(args: string[]): RelayRun | null;
  /** Ask for a playlist (fetch-playlist.ts). */
  fetchPlaylist(url: string, signal: AbortSignal): Promise<PlaylistFetch>;
  /** yt-dlp's look at a YouTube link: what it printed, or why it could not look (in plain words). */
  lookYoutube(
    url: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; json: string } | { ok: false; message: string }>;
  /** The stream is on air or recording. */
  onAir(): boolean;
  /** Where each link's local stream is written, in a folder of its own. */
  root: string;
  progress(dir: string): Promise<LocalProgress>;
  /** A local stream's own playlist as it is now (null while it is not written). */
  readPlaylist(dir: string): Promise<string | null>;
  makeFolder(dir: string): void;
  /** Remove a link's folder, once its FFmpeg has gone. */
  removeFolder(dir: string): Promise<void>;
  /** The engine's own: put a link up (the operator's change), the Wallpaper up for a dropped one, a link off. */
  showLink(link: { linkId: string; name: string }): CommandResult;
  /** Every page joins it afresh (a new start for all at once), the link carrying on: bookkeeping, never the operator's. */
  restartLink(linkId: string): CommandResult;
  dropped(linkId: string): CommandResult;
  clearLink(linkId: string): CommandResult;
  state(): EngineState;
  /** The operator window is told how it stands, whenever that changes. */
  changed(status: StreamLinkStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  newId(): string;
  /** A test run: no address but this computer's own is ever asked (no test reaches the internet). */
  guard: boolean;
  /** How often the local stream is looked at (500 ms). */
  pollMs?: number;
  /** How long a new link may take to give its first pictures (20 s). */
  firstMs?: number;
}

export const TEST_GUARD =
  'Test guard: a stream link was asked of somewhere other than 127.0.0.1, so it was stopped.';

export function joinedPlaylist(_text: string, _from: number, _until: number): string {
  return '';
}

export class LiveLinkService {
  constructor(private readonly deps: LiveLinkDeps) {}

  view(): StreamLinkStatus {
    return STREAM_LINK_OFF;
  }

  show(_raw: string): Promise<StreamLinkResult> {
    return Promise.resolve({ ok: false, message: '' });
  }

  stop(): void {
    this.deps.log('info', 'Stream link: not built yet');
  }

  follow(): void {
    // Not built yet.
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  join(_linkId: string): { segment: number; startAt: number } | null {
    return null;
  }

  playlistFor(_linkId: string, _segment: number): Promise<string | null> {
    return Promise.resolve(null);
  }

  folderOf(_linkId: string): string | null {
    return null;
  }
}
