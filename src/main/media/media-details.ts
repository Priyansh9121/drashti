import type { MediaDetailsResult } from '../../shared/media-details';
import type { CodecLevel } from '../import/codec-config';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, his "Yes, all A" to Q60-39), in the main process: a video's
 * or a sound's file read by the bundled FFmpeg (`-i`, which reads its header and index and decodes nothing) at low
 * priority, one file at a time and for 15 s at most, so the show never waits for it; what it read kept by the file's
 * bytes (its sha256), which never change. With the library's own notes on it: its size, its length, when and from
 * where it came in, and how Drashti plays it. Nothing here changes the file, the library or the show.
 */

/** The longest FFmpeg may take to read a file for its information. */
export const DETAILS_READ_MS = 15_000;

/** What the library says of a media item, for its information (db/media.ts about()). */
export interface DetailsRow {
  name: string;
  kind: 'image' | 'video' | 'audio';
  /** Relative to the media folder ('' while missing). */
  path: string;
  sha256: string | null;
  bytes: number | null;
  missing: boolean;
  deleted: boolean;
  /** Whether Drashti plays it as it is: true, false, or null when not sure. */
  playable: boolean | null;
  /** What it is, as found at import. */
  format: string | null;
  durationMs: number | null;
  importedAt: string | null;
  importedFrom: string | null;
  /** The copy everything uses, when it was converted: its name. */
  convertedTo: string | null;
  /** The original it is a copy of, when Drashti made it: its name. */
  copyOf: string | null;
}

/** What FFmpeg printed, or that it took too long; null when it could not be started. */
export type Reading = { text: string; timedOut: boolean } | null;

export interface MediaDetailsDeps {
  mediaDir: string;
  row(mediaId: string): DetailsRow | null;
  /** The bundled FFmpeg; null when it is not there. */
  ffmpeg(): string | null;
  /** Being converted (waiting for its turn, or converting) now. */
  converting(mediaId: string): boolean;
  /** FFmpeg's reading of a file (the default runs it at low priority, for DETAILS_READ_MS at most). */
  read?: (ffmpeg: string, file: string) => Promise<Reading>;
  /** A video's profile and level from its own codec record (import/codec-config.ts). */
  level?: (file: string) => Promise<CodecLevel | null>;
}

/** Red (x47): still to be written. */
export const readWithFfmpeg = (
  _ffmpeg: string,
  _file: string,
  _timeoutMs = DETAILS_READ_MS,
): Promise<Reading> => Promise.resolve(null);

/** Why a file was not read, in words. */
export const NOT_READ = {
  missing: 'Drashti cannot find its file, so only what the library knows is shown.',
  noFfmpeg: 'Drashti’s own FFmpeg is not on this computer, so only what the library knows is shown.',
  timedOut: `Drashti could not read the file within ${String(DETAILS_READ_MS / 1000)} seconds, so only what the library knows is shown.`,
  unread:
    'FFmpeg could not read what is inside the file (it may be damaged), so only what the library knows is shown.',
} as const;

export class MediaDetailsService {
  constructor(private readonly deps: MediaDetailsDeps) {}

  details(_mediaId: string): Promise<MediaDetailsResult> {
    return Promise.resolve({ ok: false, message: `Not yet (${this.deps.mediaDir}).` });
  }
}
