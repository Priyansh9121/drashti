import type { Db } from '../db/database';
import type { MediaInfo } from './plan';

/*
 * "Plays anything" (alpha.20: the owner's Q60-34 item 2, his "Yes, all A" to Q60-39): every video and sound the bundled
 * FFmpeg has never read (a library from before Session 50, a computer that had no FFmpeg then: its file's own header
 * judged it, migration 86's read_by NULL) is read once, by itself, at idle moments: the caller (convert-service.ts) asks
 * only while nothing is up, the stream is off air and not recording, and no conversion waits or goes on; here one file at
 * a time, FFmpeg below normal priority, REREAD_EVERY_MS apart. What FFmpeg reads decides as at an import (plan.ts
 * atImport, HEVC as this computer's window says, so never converted here): a file Drashti's player cannot play is marked
 * so and converted by itself; one that plays is marked so; one FFmpeg reads nothing in keeps its header's judgement.
 * A write the library is too busy for waits for the next turn, never for the library (the main process carries the show).
 */

/** How long after one file is read the next may be. */
export const REREAD_EVERY_MS = 3000;

/** A library file never read by FFmpeg. */
export interface Unread {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  path: string;
}

export interface RereadDeps {
  db: Db;
  mediaDir: string;
  ffmpegPath(): string | null;
  /** What FFmpeg reads in a file (default: FFmpeg's `-i` below normal priority, 15 s at most); null when it could not. */
  read?(ffmpeg: string, file: string): Promise<(MediaInfo & { timedOut?: true }) | null>;
  /** A file it found Drashti's player cannot play, marked so: converted by itself. */
  convert(mediaId: string): void;
  log(message: string): void;
  /** The library's usual busy timeout (ms), put back after each write. */
  busyTimeoutMs: number;
}

/** Red (x47, slice 2): the sweep, still to be written. */
export class Reread {
  constructor(
    private readonly deps: RereadDeps,
    private readonly everyMs = REREAD_EVERY_MS,
  ) {}

  next(): Unread | null {
    return this.deps.mediaDir === '' && this.everyMs < 0 ? null : null;
  }

  step(_now: number): Promise<boolean> {
    return Promise.resolve(false);
  }
}
