import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { extname, join } from 'node:path';
import type { FileRead, InDrashti, MediaDetails, MediaDetailsResult } from '../../shared/media-details';
import { cutText } from '../../shared/text';
import { parseMediaDetails } from '../convert/media-details-parse';
import { type CodecLevel, readCodecLevel } from '../import/codec-config';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, his "Yes, all A" to Q60-39), in the main process: a video's
 * or a sound's file read by the bundled FFmpeg (`-i`, which reads its header and index and decodes nothing) at low
 * priority, one file at a time and for 15 s at most, so the show never waits for it; what it read kept by the file's
 * bytes (its sha256), which never change. With the library's own notes on it: its size, its length, when and from
 * where it came in, and how Drashti plays it. Nothing here changes the file, the library or the show.
 */

/** The longest FFmpeg may take to read a file for its information. */
export const DETAILS_READ_MS = 15_000;
/** The most of FFmpeg's text kept (a file with thousands of chapters or streams says a great deal). */
const MOST_TEXT = 512 * 1024;
/** How many files' readings are kept. */
const KEPT = 200;

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
  /** How many times it has gone up, and when it last did (alpha.20, migration 88); 0 and null until then. */
  playCount: number;
  lastPlayedAt: string | null;
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

/**
 * Run the bundled FFmpeg on a file as Media information reads it: its header and index only (no output), the stream's
 * clean environment, only files opened, below normal priority, killed after `timeoutMs`.
 */
export function readWithFfmpeg(ffmpeg: string, file: string, timeoutMs = DETAILS_READ_MS): Promise<Reading> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-i', file], {
      windowsHide: true,
      env: ffmpegEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Some systems let it run only at normal priority.
    }
    let text = '';
    let timedOut = false;
    let done = false;
    const finish = (reading: Reading) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(reading);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => {
      if (text.length < MOST_TEXT) text += chunk.toString();
    });
    child.on('error', () => {
      finish(null);
    });
    child.on('close', () => {
      finish({ text: cutText(text, MOST_TEXT), timedOut });
    });
  });
}

/** How Drashti plays it, from its library row. */
function inDrashti(row: DetailsRow, converting: boolean): InDrashti {
  if (row.missing || row.deleted) return { state: 'missing' };
  if (row.convertedTo !== null) return { state: 'converted', copy: row.convertedTo };
  if (converting) return { state: 'converting' };
  if (row.copyOf !== null) return { state: 'copy', of: row.copyOf };
  if (row.playable === false)
    return { state: 'cannot', format: row.format ?? 'a kind of file Drashti cannot play' };
  return row.playable === null ? { state: 'maybe' } : { state: 'plays' };
}

/** Why a file was not read, in words. */
export const NOT_READ = {
  missing: 'Drashti cannot find its file, so only what the library knows is shown.',
  noFfmpeg: 'Drashti’s own FFmpeg is not on this computer, so only what the library knows is shown.',
  timedOut: `Drashti could not read the file within ${String(DETAILS_READ_MS / 1000)} seconds, so only what the library knows is shown.`,
  unread:
    'FFmpeg could not read what is inside the file (it may be damaged), so only what the library knows is shown.',
} as const;

export class MediaDetailsService {
  /** Readings by the file's sha256, the newest last. */
  private readonly kept = new Map<string, FileRead>();
  /** A reading under way, by sha256: a second ask for the same file waits for it. */
  private readonly going = new Map<string, Promise<FileRead | keyof typeof NOT_READ>>();
  /** One file at a time. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: MediaDetailsDeps) {}

  /** A video's or a sound's information; refused in words for anything else. */
  async details(mediaId: string): Promise<MediaDetailsResult> {
    const row = this.deps.row(mediaId);
    if (!row) return { ok: false, message: 'That file is no longer in the library.' };
    if (row.kind === 'image') return { ok: false, message: 'Media information is for videos and sounds.' };
    const base: MediaDetails = {
      mediaId,
      name: row.name,
      kind: row.kind,
      bytes: row.missing ? null : row.bytes,
      libraryDurationMs: row.durationMs,
      importedAt: row.importedAt,
      importedFrom: row.importedFrom,
      inDrashti: inDrashti(row, this.deps.converting(mediaId)),
      plays: { count: row.playCount, lastAt: row.lastPlayedAt },
      read: null,
      problem: null,
    };
    if (row.missing || row.deleted || !row.sha256 || row.path === '')
      return { ok: true, details: { ...base, problem: NOT_READ.missing } };
    const read = await this.readingOf(row.sha256, join(this.deps.mediaDir, row.path));
    return {
      ok: true,
      details: typeof read === 'string' ? { ...base, problem: NOT_READ[read] } : { ...base, read },
    };
  }

  /** What FFmpeg reads in this file: kept, under way, or read now in its turn. */
  private readingOf(sha256: string, file: string): Promise<FileRead | keyof typeof NOT_READ> {
    const kept = this.kept.get(sha256);
    if (kept) return Promise.resolve(kept);
    const going = this.going.get(sha256);
    if (going) return going;
    const now = this.turn.then(() => this.readNow(file));
    this.turn = now.catch(() => undefined);
    const tracked = now.then(
      (read) => {
        this.going.delete(sha256);
        if (typeof read !== 'string') this.keep(sha256, read);
        return read;
      },
      () => {
        this.going.delete(sha256);
        return 'unread' as const;
      },
    );
    this.going.set(sha256, tracked);
    return tracked;
  }

  private async readNow(file: string): Promise<FileRead | keyof typeof NOT_READ> {
    const ffmpeg = this.deps.ffmpeg();
    if (!ffmpeg) return 'noFfmpeg';
    const reading = await (this.deps.read ?? readWithFfmpeg)(ffmpeg, file);
    if (reading?.timedOut) return 'timedOut';
    if (!reading || !/^Input #0, /mu.test(reading.text)) return 'unread';
    const read = parseMediaDetails(reading.text, extname(file).slice(1));
    const first = read.pictures[0];
    if (first && (first.codec === 'h264' || first.codec === 'hevc')) {
      const level = await (this.deps.level ?? readCodecLevel)(file).catch(() => null);
      if (level?.codec === first.codec) first.level = level.level;
    }
    return read;
  }

  /** Keep a reading, letting go of the oldest past KEPT. */
  private keep(sha256: string, read: FileRead): void {
    this.kept.delete(sha256);
    this.kept.set(sha256, read);
    while (this.kept.size > KEPT) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
  }
}
