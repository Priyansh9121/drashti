import { extname, join } from 'node:path';
import type { Db } from '../db/database';
import { isBusy } from '../db/later-writes';
import { readWithFfmpeg } from '../media/media-details';
import { atImport, describeMedia, type MediaInfo, parseFfmpegInfo } from './plan';

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

/** FFmpeg's reading, below normal priority (media/media-details.ts), as the import's reading reads it. */
async function readQuietly(ffmpeg: string, file: string): Promise<(MediaInfo & { timedOut?: true }) | null> {
  const reading = await readWithFfmpeg(ffmpeg, file);
  if (!reading) return null;
  return reading.timedOut ? { ...parseFfmpegInfo(''), timedOut: true } : parseFfmpegInfo(reading.text);
}

export class Reread {
  private going = false;
  private nextAt = 0;

  constructor(
    private readonly deps: RereadDeps,
    private readonly everyMs = REREAD_EVERY_MS,
  ) {}

  /** The oldest file never read: a video or sound with its file, not Drashti's own copy, not converted already. */
  next(): Unread | null {
    return (
      (this.deps.db
        .prepare(
          `SELECT m.id, m.kind, m.name, m.path FROM media m
            WHERE m.kind IN ('video', 'audio') AND m.read_by IS NULL AND m.missing = 0 AND m.deleted_at IS NULL
              AND m.path <> '' AND m.converted_from IS NULL
              AND NOT EXISTS (SELECT 1 FROM media_conversions mc WHERE mc.original_id = m.id AND mc.undone_at IS NULL)
            ORDER BY m.rowid LIMIT 1`,
        )
        .get() as Unread | undefined) ?? null
    );
  }

  /**
   * An idle moment (the caller asks only then): read one file never read, when one is due. True when one was read.
   */
  async step(now: number): Promise<boolean> {
    if (this.going || now < this.nextAt) return false;
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return false;
    const unread = this.next();
    if (!unread) return false;
    this.going = true;
    this.nextAt = now + this.everyMs;
    try {
      const info = await (this.deps.read ?? readQuietly)(ffmpeg, join(this.deps.mediaDir, unread.path));
      const verdict = info && !info.timedOut ? atImport(unread.kind, info) : 'unread';
      if (!info || verdict === 'unread') {
        this.write(unread.id, 'nothing', null);
        return true;
      }
      const format = describeMedia(unread.kind, info, extname(unread.path).slice(1));
      if (verdict === 'convert') {
        if (this.write(unread.id, 'ffmpeg', { playable: 0, format })) {
          this.deps.log(
            `Read by FFmpeg now (it was judged by its header): converting it by itself (${format})`,
          );
          this.deps.convert(unread.id);
        }
      } else if (verdict === 'plays') this.write(unread.id, 'ffmpeg', { playable: 1, format });
      // HEVC: whether it plays is this computer's window's to say, as at an import.
      else this.write(unread.id, 'ffmpeg', null);
      return true;
    } finally {
      this.going = false;
    }
  }

  /** Record what was read, if the library is free now; false when it was busy (it is read again next turn). */
  private write(
    id: string,
    readBy: 'ffmpeg' | 'nothing',
    play: { playable: 0 | 1; format: string } | null,
  ): boolean {
    const db = this.deps.db;
    db.pragma('busy_timeout = 0');
    try {
      if (play)
        db.prepare('UPDATE media SET read_by = ?, playable = ?, format = ? WHERE id = ?').run(
          readBy,
          play.playable,
          play.format,
          id,
        );
      else db.prepare('UPDATE media SET read_by = ? WHERE id = ?').run(readBy, id);
      return true;
    } catch (error) {
      // Busy: read again next turn. Anything else is said, never thrown into the idle moment's caller.
      if (!isBusy(error)) this.deps.log(`What FFmpeg read could not be kept: ${(error as Error).message}`);
      return false;
    } finally {
      db.pragma(`busy_timeout = ${String(this.deps.busyTimeoutMs)}`);
    }
  }
}
