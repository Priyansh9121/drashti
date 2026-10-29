import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { readInfo } from '../convert/read-info';
import type { SoundFile, SoundRepo } from '../db/sound';
import { findEdges, readSound } from './read-sound';

/*
 * The sound pass (Session 55, Part 7): Drashti reads each video's and sound's sound once, one file at a time, in the
 * background, with FFmpeg at the lowest priority on one core (read-sound.ts), and never changes a file.
 *
 * - Its loudness (even loudness: shared/sound.ts) and its length (P3: a stage layout's time left and the last 10
 *   seconds work before a file has played): the files an import brought in first, a moment after it ends; and, once,
 *   a while after Drashti starts, every file the library had already that is not measured yet, oldest first. Bytes
 *   that change (a file found again, a conversion's copy) are new bytes, read in turn. It only decodes sound, so it
 *   also goes on while the stream is on air.
 * - A video imported with From a Link… also gets its start and end points past the black and silence at its start
 *   and end (when it has no points of its own yet). That reads its pictures, so it waits while the stream is on air or
 *   recording, as conversions do. Any video's menu (Trim black and silence) asks for it at once.
 *
 * What it found is written as the show's own later writes are (db/later-writes.ts): an import holding the library never
 * keeps the main process waiting.
 */

/** How long after Drashti starts the library's files not measured yet begin (ms): the screens and sound settle first. */
export const AFTER_START_MS = 60_000;
/** How long after an import ends its files are read (ms): its own next steps (Audio's playlist, a conversion) first. */
export const AFTER_IMPORT_MS = 2000;
/** A breath between two files (ms). */
export const BETWEEN_MS = 250;
/** While the stream is on air or recording, a link video's black and silence are looked for again this often (ms). */
export const ON_AIR_RETRY_MS = 30_000;

/** A video's start and end points past its black and silence (ms; no end point: its own end). */
export interface EdgePoints {
  startMs: number;
  endMs: number | null;
}

export interface SoundPassDeps {
  repo: Pick<SoundRepo, 'toMeasure' | 'file' | 'saveMeasured' | 'keepLength'>;
  /** The media folder: a row's path is relative to it. */
  mediaDir: string;
  ffmpegPath(): string | null;
  /** Why reading pictures waits now (the stream on air or recording), or null. */
  busy(): string | null;
  /** A write the show makes by itself, made when the library is free (db/later-writes.ts). */
  write(key: string, run: () => void): void;
  /** A file is measured: what plays it follows its gain; `lengthMs` when its length was kept just now. */
  measured(mediaId: string, lengthMs: number | null): void;
  /** A link video's points past its black and silence, kept when it has none of its own (true when kept). */
  keepPoints(mediaId: string, points: EdgePoints): boolean;
  log(level: 'info' | 'warn', message: string): void;
  /** Tests: FFmpeg's reading, the waits, and when to run. */
  read?: typeof readSound;
  info?: typeof readInfo;
  edges?: typeof findEdges;
  schedule?: (ms: number, run: () => void) => () => void;
  afterStartMs?: number;
  afterImportMs?: number;
  betweenMs?: number;
}

/** One job: a file to measure, and whether to find its black and silence too (a link video). */
interface Job {
  mediaId: string;
  edges: boolean;
}

export class SoundPass {
  private readonly queue: Job[] = [];
  private running = false;
  private closed = false;
  private child: ChildProcess | null = null;
  private waiting: (() => void) | null = null;
  /** Files whose bytes FFmpeg took too long over this run: tried again at the next start, not now. */
  private readonly slow = new Set<string>();

  constructor(private readonly deps: SoundPassDeps) {}

  private schedule(ms: number, run: () => void): () => void {
    if (this.deps.schedule) return this.deps.schedule(ms, run);
    const t = setTimeout(run, ms);
    return () => {
      clearTimeout(t);
    };
  }

  /** Once, a while after the start: every file the library has that is not measured yet, at the back of the line. */
  startLibrary(): void {
    this.schedule(this.deps.afterStartMs ?? AFTER_START_MS, () => {
      if (this.closed) return;
      const files = this.deps.repo.toMeasure();
      if (files.length > 0) this.deps.log('info', `Sound: ${String(files.length)} file(s) to measure`);
      for (const f of files) this.add({ mediaId: f.id, edges: false }, false);
    });
  }

  /**
   * An import ended: its videos and sounds first in line, a moment later; `fromLink`, its videos' black and silence
   * found too.
   */
  imported(mediaIds: readonly string[], fromLink: boolean): void {
    if (mediaIds.length === 0) return;
    this.schedule(this.deps.afterImportMs ?? AFTER_IMPORT_MS, () => {
      if (this.closed) return;
      const files = this.deps.repo.toMeasure(mediaIds);
      const measuring = new Set(files.map((f) => f.id));
      // Already measured (the same bytes imported again): only a link video's edges are still to find.
      const jobs: Job[] = [
        ...files.map((f) => ({ mediaId: f.id, edges: fromLink && f.kind === 'video' })),
        ...(fromLink
          ? mediaIds
              .filter((id) => !measuring.has(id) && this.deps.repo.file(id)?.kind === 'video')
              .map((id) => ({ mediaId: id, edges: true }))
          : []),
      ];
      for (const job of jobs.reverse()) this.add(job, true);
    });
  }

  /** Files waiting (for tests and diagnostics). */
  get pending(): number {
    return this.queue.length;
  }

  private add(job: Job, first: boolean): void {
    const at = this.queue.findIndex((j) => j.mediaId === job.mediaId);
    if (at >= 0) {
      const [was] = this.queue.splice(at, 1);
      job = { ...job, edges: job.edges || (was?.edges ?? false) };
    }
    if (first) this.queue.unshift(job);
    else this.queue.push(job);
    this.next();
  }

  private next(): void {
    if (this.running || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    void this.run(job)
      .catch((error: unknown) => {
        this.deps.log(
          'warn',
          `Sound: a file could not be read (${error instanceof Error ? error.message : 'unknown'})`,
        );
      })
      .finally(() => {
        this.running = false;
        this.child = null;
        if (this.closed) return;
        this.waiting = this.schedule(this.deps.betweenMs ?? BETWEEN_MS, () => {
          this.waiting = null;
          this.next();
        });
      });
  }

  private async run(job: Job): Promise<void> {
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return;
    const [toRead] = this.slow.has(job.mediaId) ? [] : this.deps.repo.toMeasure([job.mediaId]);
    let file: SoundFile | null = toRead ?? null;
    let audio: boolean | null = null;
    let lengthMs: number | null = null;
    if (file) {
      const read = await (this.deps.read ?? readSound)(ffmpeg, join(this.deps.mediaDir, file.path), {
        knownMs: file.durationMs,
        onSpawn: (child) => {
          this.child = child;
        },
      });
      if (this.closed) return;
      audio = read.audio;
      lengthMs = read.lengthMs ?? file.durationMs;
      const measured = read.loudness;
      const id = file.id;
      const sha = file.sha256;
      const known = file.durationMs;
      // Too long (a busy computer): left to the next start. Unreadable: said so, and not read again.
      if (read.timedOut) this.slow.add(id);
      else
        this.deps.write(`loudness:${id}`, () => {
          this.deps.repo.saveMeasured(id, sha, measured ?? 'failed');
          const kept =
            read.lengthMs !== null && known === null && this.deps.repo.keepLength(id, read.lengthMs);
          this.deps.measured(id, kept ? read.lengthMs : null);
        });
    }
    if (!job.edges) return;
    file ??= this.deps.repo.file(job.mediaId);
    if (file?.kind !== 'video') return;
    // A link video's black and silence read its pictures: never while the stream is on air or recording.
    if (this.deps.busy() !== null) {
      this.schedule(ON_AIR_RETRY_MS, () => {
        this.add({ mediaId: job.mediaId, edges: true }, false);
      });
      return;
    }
    const points = await this.findPoints(ffmpeg, file, lengthMs, audio);
    if (this.closed || !points) return;
    if (this.deps.keepPoints(file.id, points))
      this.deps.log('info', 'Sound: a link video’s start and end points were set past its black and silence');
  }

  /** A video's points past its black and silence (its length and sound track read first when not known). */
  private async findPoints(
    ffmpeg: string,
    file: SoundFile,
    lengthMs: number | null,
    audio: boolean | null,
  ): Promise<EdgePoints | null> {
    const path = join(this.deps.mediaDir, file.path);
    let length = lengthMs ?? file.durationMs;
    let hasAudio = audio;
    // What it holds, read as an import reads it (quick: nothing decoded).
    if (length === null || hasAudio === null) {
      const info = await (this.deps.info ?? readInfo)(ffmpeg, path, {
        onSpawn: (child) => {
          this.child = child;
        },
      });
      length ??= info.durationMs;
      hasAudio = info.audio !== null;
    }
    if (length === null || this.closed) return null;
    return (this.deps.edges ?? findEdges)(ffmpeg, path, length, hasAudio, {
      onSpawn: (child) => {
        this.child = child;
      },
    });
  }

  /**
   * A video's points past its black and silence now (its menu's Trim black and silence), at the lowest priority: the
   * operator asked, so it never waits for the stream. Null when it has none to cut, or could not be read.
   */
  async edgesNow(
    mediaId: string,
  ): Promise<{ ok: true; points: EdgePoints | null } | { ok: false; message: string }> {
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return { ok: false, message: 'Drashti’s FFmpeg is missing: install Drashti again.' };
    const file = this.deps.repo.file(mediaId);
    if (file?.kind !== 'video')
      return { ok: false, message: 'Only a video in the library has black and silence to trim.' };
    const points = await this.findPoints(ffmpeg, file, null, null);
    return { ok: true, points };
  }

  /** Drashti is quitting: nothing more starts, and FFmpeg reading now stops. */
  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.waiting?.();
    this.waiting = null;
    this.child?.kill('SIGKILL');
  }
}
