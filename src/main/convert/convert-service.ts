import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';
import type { ConversionJob, ConvertResult } from '../../shared/convert';
import { isHevc } from '../../shared/convert';
import type { ImportIssue } from '../../shared/import';
import type { Db } from '../db/database';
import { CONVERTING_DIR, MediaStore, sha256File } from '../import/media-store';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { ProgressReader } from '../stream/worker/progress';
import { fileProblem } from '../plain-errors';
import {
  chooseTarget,
  convertArgs,
  type ConvertTarget,
  type MediaInfo,
  TARGET_EXT,
  TARGET_FORMAT,
} from './plan';
import { PROBE_MS, readInfo } from './read-info';
import { copyFinder, moveBack, moveMedia, type Moved, presentationsMoved } from './relink';
import { freeFileName } from './trim';

/*
 * Converting media Drashti cannot play (PLAN.md 4.4), one file at a time,
 * in the background, with FFmpeg at the lowest priority. A conversion waits
 * while the show is on, the stream is on air or a recording is running.
 * One already going stops and starts again afterwards, and none starts or
 * carries on with less than 2 GB free. The original is never changed or deleted: the converted file
 * goes into the media folder as a media item of its own, and everything
 * that used the original is moved to it (src/main/convert/relink.ts), kept
 * so Undo can move it back. What is on the screens is left alone: it keeps
 * playing the original until it is taken down.
 *
 * Session 50: what an import finds Drashti's player cannot play (a video or a
 * sound: import/media-store.ts reads each with FFmpeg) is converted by itself,
 * in the same queue, a moment after the import ends (convertImported).
 *
 * Session 51: the conversions not finished are kept with the library as they
 * change, so those waiting or going on when Drashti quits (or stops) wait
 * again at its next start, and start by themselves once the stream's own
 * start is known (resumeWaiting).
 */

export const KEEP_FREE_BYTES = 2 * 1024 ** 3;

// Reading what a file holds is its own module (Session 50: the import worker reads every video and sound).
export { PROBE_MS, readInfo };

/**
 * How long a conversion an import found waits before it starts (Session 50): what the import's own next steps
 * add (Audio's playlist, a folder playlist's items) points at the file by then, and so is moved to the copy.
 */
export const AFTER_IMPORT_MS = 2000;

/**
 * How long after the stream's own start is known the conversions kept from the last run wait before they start
 * (Session 51): the screens and the stream settle first.
 */
export const AFTER_START_MS = 10_000;

/** An import report's lines, as convertImported reads them. */
export interface ImportedLines {
  items: readonly { issues: readonly ImportIssue[] }[];
}

/**
 * The longest a conversion or a Save as MP4 may take, each time it is tried: four times the file's length,
 * and 5 minutes more (a file whose length is not known gets the 5 minutes). Longer, FFmpeg is stuck.
 */
export const workMsFor = (lengthMs: number | null): number => 4 * (lengthMs ?? 0) + 5 * 60_000;

/** A time limit said plainly: "30 seconds", "1 second", "13 minutes". */
function spoken(ms: number): string {
  if (ms < 60_000) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `${String(s)} second${s === 1 ? '' : 's'}`;
  }
  const m = Math.round(ms / 60_000);
  return `${String(m)} minute${m === 1 ? '' : 's'}`;
}

export interface ConvertDeps {
  db: Db;
  mediaDir: string;
  ffmpegPath(): string | null;
  /** Why jobs must wait for the stream or a recording, or null. */
  busy(): string | null;
  /** Background conversions also wait while there is something live. */
  showBusy?(): boolean;
  freeBytes(dir: string): number;
  /** The jobs changed: the operator window is told. */
  changed(jobs: ConversionJob[]): void;
  /** A conversion was made or undone: these presentations' slides are read again; the lists reload. */
  libraryChanged(presentations: string[]): void;
  log(level: 'info' | 'warn', message: string): void;
  /**
   * Tests: shorter time limits than PROBE_MS and workMsFor, and waits after an import and after the start than
   * AFTER_IMPORT_MS and AFTER_START_MS.
   */
  limits?: {
    probeMs?: number;
    workMs?(lengthMs: number | null): number;
    afterImportMs?: number;
    afterStartMs?: number;
  };
  /**
   * The conversions not finished, by media item in order, kept with the library (Session 51): what was kept when
   * Drashti last stopped, and keeping it as it changes.
   */
  kept?: { load(): unknown; save(pending: KeptConversion[]): void };
  /**
   * Each FFmpeg started, and its end (Session 31, ROB-3: ../system/leftovers.ts), so one left running by a
   * crash is stopped at the next start, with the part-file it was writing.
   */
  children?: {
    started(pid: number | undefined, partFile?: string): void;
    ended(pid: number | undefined): void;
  };
}

interface MediaRow {
  id: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  path: string;
  source_path: string | null;
  playable: number | null;
  format: string | null;
  /** 1: deleted from the library (Session 26a), perhaps while its conversion waited. */
  deleted: number;
}

const idSchema = z.string().min(1).max(100);
const idsSchema = z.array(idSchema).min(1).max(10_000);
const maxHeightSchema = z.number().int().min(2).max(1080);
/** Earlier versions kept just the media id. A linked video's job also needs its height cap. */
const keptSchema = z
  .array(z.union([idSchema, z.object({ mediaId: idSchema, maxHeight: maxHeightSchema })]))
  .max(10_000);
type KeptConversion = z.infer<typeof keptSchema>[number];
const movedSchema = z.object({
  cues: z.array(z.string()),
  items: z.array(z.string()),
  kirtans: z.array(z.string()),
  elements: z.array(z.string()),
  props: z.array(z.string()),
  themes: z.array(z.string()),
  // Audio playlists' tracks (Session 14), kept so Undo moves them back too.
  tracks: z.array(z.string()).optional(),
  // A deck's slides whose own videos and sounds moved (Session 54, C2).
  decks: z.array(z.string()).optional(),
});

const KIND_OF: Record<ConvertTarget, MediaRow['kind']> = {
  mp4: 'video',
  'webm-alpha': 'video',
  jpeg: 'image',
  png: 'image',
  m4a: 'audio',
};

/** What the operator is told when reading a file took too long. */
const probeTooLong = (ms: number) =>
  `FFmpeg took longer than ${spoken(ms)} to read this file, so it was stopped. The file may be damaged: try opening it in another program.`;

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Remove a part-file; one still open (Windows) is left for the next start to clear. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleared at the next start.
  }
}

/**
 * Why a conversion stopped: cancelled, Drashti quitting, the show or stream started, the disk ran out of
 * space, or it took longer than its time limit (Session 31).
 */
type Stop = 'cancel' | 'quit' | 'wait' | 'space' | 'time';

interface Running {
  job: ConversionJob;
  child: ChildProcess | null;
  tmp: string | null;
  stop: Stop | null;
  /** The time limit this attempt had (ms), once it started. */
  limitMs: number;
}

/** Making a file no taller than a height (Session 25b): a downloaded video above 1080p, before its import. */
export interface FitOptions {
  maxHeight: number;
  /** How far it has got (0 to 1), when it can be told. */
  progress?(fraction: number | null): void;
  /** Why it waits, or null when it goes on. */
  waiting?(note: string | null): void;
}

/** The copy made (null: it was no taller already), or why none could be (`stopped`: someone stopped it). */
export type FitResult = { ok: true; copy: string | null } | { ok: false; message: string; stopped?: boolean };

/**
 * Saving a video's part as an MP4 of its own (Session 26e): FFmpeg copying its streams into a part-file,
 * named as it should be only once whole, run as converting is (one at a time, the lowest priority, waiting
 * while on air or recording, keeping 2 GB free).
 */
export interface CopyOptions {
  /** FFmpeg's arguments, writing to `tmp`. */
  args(tmp: string): string[];
  /** How long the part saved lasts, for its progress. */
  lengthMs: number;
  /** Wait while show layers are up, including when a show starts during the copy. */
  waitForShow?: boolean;
  progress?(fraction: number | null): void;
  waiting?(note: string | null): void;
}

interface FileJob {
  id: string;
  waitForShow: boolean;
  source: string;
  dest: string;
  info: MediaInfo;
  options: FitOptions;
  /** A part saved: its FFmpeg arguments and length. */
  copy: CopyOptions | null;
  note: string | null;
  resolve(result: FitResult): void;
}

interface RunningFile {
  job: FileJob;
  child: ChildProcess | null;
  tmp: string;
  stop: Stop | null;
  limitMs: number;
}

export class ConvertService {
  private jobs: ConversionJob[] = [];
  private running: Running | null = null;
  /** Files waiting to be made no taller than a height (after the library's own jobs), and the one going. */
  private files: FileJob[] = [];
  private runningFile: RunningFile | null = null;
  /**
   * Conversions an import found, by job, and when each may start (Session 50); those kept from the last run wait
   * for resumeWaiting (Session 51).
   */
  private readonly heldUntil = new Map<string, number>();
  private readonly timer: NodeJS.Timeout;
  /** The conversions not finished as last kept (Session 51), to keep them again only when they change. */
  private keptNow = '';
  /** Quitting: what changes from now on is not kept (what was waiting or going on starts again next time). */
  private closed = false;
  /** Once idle after the start (Session 51 review): what still uses a converted original moves to its copy. */
  private followAtStart = false;

  /** How long reading what a file holds may take (tests give less). */
  private probeMs(): number {
    return this.deps.limits?.probeMs ?? PROBE_MS;
  }

  /** How long converting or saving a file of this length may take, each time it is tried. */
  private workMs(lengthMs: number | null): number {
    return (this.deps.limits?.workMs ?? workMsFor)(lengthMs);
  }

  constructor(private readonly deps: ConvertDeps) {
    // Part-files left by a conversion that was going when Drashti stopped.
    removeQuietly(join(deps.mediaDir, CONVERTING_DIR));
    // Every second: start the next file, or make the one going wait (the show, the stream, the disk).
    this.timer = setInterval(() => {
      this.watch();
    }, 1000);
    this.timer.unref();
    // Those not finished when Drashti last stopped (Session 51): waiting again, held until resumeWaiting.
    const kept = keptSchema.safeParse(deps.kept?.load());
    if (kept.success && kept.data.length > 0) {
      this.keptNow = JSON.stringify(kept.data);
      const ids = kept.data.map((job) => (typeof job === 'string' ? job : job.mediaId));
      const heights = new Map(
        kept.data.flatMap((job) => (typeof job === 'string' ? [] : [[job.mediaId, job.maxHeight] as const])),
      );
      this.enqueue(ids, Number.POSITIVE_INFINITY, heights);
    }
  }

  /**
   * The conversions waiting when Drashti last stopped start again by themselves, a moment from now (Session 51):
   * called once the stream's own start is known (index.ts: once the operator window has opened, after the stream
   * may have gone on air again by itself).
   */
  resumeWaiting(): void {
    const at = Date.now() + (this.deps.limits?.afterStartMs ?? AFTER_START_MS);
    let resumed = 0;
    for (const [id, until] of this.heldUntil)
      if (until === Number.POSITIVE_INFINITY) {
        this.heldUntil.set(id, at);
        resumed++;
      }
    if (resumed > 0)
      this.deps.log(
        'info',
        resumed === 1
          ? '1 conversion waiting when Drashti last stopped starts again by itself'
          : `${String(resumed)} conversions waiting when Drashti last stopped start again by themselves`,
      );
    // And, once off air, what was added on a converted original before Session 51 moves to its copy.
    this.followAtStart = true;
  }

  /**
   * What still uses an original whose conversion stands, its copy in the library, moves to the copy (Session 51
   * review: added by hand before Session 51, it had landed on the original), kept with the conversion for its Undo.
   */
  private followStanding(): void {
    const standing = this.deps.db
      .prepare(
        `SELECT mc.id, mc.original_id, mc.converted_id, mc.moved FROM media_conversions mc
           JOIN media c ON c.id = mc.converted_id
          WHERE mc.undone_at IS NULL AND c.deleted_at IS NULL ORDER BY mc.created_at DESC, mc.rowid DESC`,
      )
      .all() as { id: string; original_id: string; converted_id: string; moved: string }[];
    const followed = new Set<string>();
    for (const done of standing) {
      // The newest conversion of each original, as copyFinder takes it.
      if (followed.has(done.original_id)) continue;
      followed.add(done.original_id);
      this.followCopy(
        done.original_id,
        done,
        'What still used a file converted before now uses its copy (added on the original before Session 51)',
      );
    }
  }

  list(): ConversionJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  private changed(): void {
    // Finished and cancelled jobs are kept a while for the window to see, then let go.
    if (this.jobs.length > 200)
      this.jobs = this.jobs.filter((j) => j.state === 'waiting' || j.state === 'converting');
    this.keep();
    this.deps.changed(this.list());
  }

  /** Keep the conversions not finished, in order, for the next start (Session 51), when they have changed. */
  private keep(): void {
    if (this.closed) return;
    const pending: KeptConversion[] = this.jobs
      .filter((j) => j.state === 'waiting' || j.state === 'converting')
      .map((j) => (j.maxHeight === undefined ? j.mediaId : { mediaId: j.mediaId, maxHeight: j.maxHeight }));
    const now = JSON.stringify(pending);
    if (now === this.keptNow) return;
    this.keptNow = now;
    this.deps.kept?.save(pending);
  }

  private row(id: string): MediaRow | null {
    return (
      (this.deps.db
        .prepare(
          'SELECT id, kind, name, path, source_path, playable, format, deleted_at IS NOT NULL AS deleted FROM media WHERE id = ?',
        )
        .get(id) as MediaRow | undefined) ?? null
    );
  }

  /** Convert these media items (each once, in turn). */
  convert(rawIds: unknown): ConvertResult {
    return this.enqueue(rawIds, null).result;
  }

  /**
   * Queue conversions an import identified, including smaller copies for tall linked videos. Each starts
   * a moment after the import (AFTER_IMPORT_MS), one at a time, once the show and stream are idle.
   * Returns the number of new jobs.
   */
  convertImported(report: ImportedLines | null): number {
    const ids = new Set<string>();
    const heights = new Map<string, number>();
    for (const item of report?.items ?? [])
      for (const { code, fix } of item.issues) {
        if (code !== 'converting-media' || fix?.kind !== 'convert-media') continue;
        ids.add(fix.mediaId);
        const height = maxHeightSchema.safeParse(fix.maxHeight);
        if (height.success)
          heights.set(fix.mediaId, Math.min(heights.get(fix.mediaId) ?? height.data, height.data));
      }
    if (ids.size === 0) return 0;
    const at = Date.now() + (this.deps.limits?.afterImportMs ?? AFTER_IMPORT_MS);
    const { added } = this.enqueue([...ids], at, heights);
    if (added > 0)
      this.deps.log(
        'info',
        `Queued ${String(added)} imported file${added === 1 ? '' : 's'} for background conversion`,
      );
    return added;
  }

  /**
   * Add jobs for these media items; how many were added. `heldUntil`: Drashti found them by itself (an import, or
   * the last run's, Session 51), and each waits until then; null: the operator asked.
   */
  private enqueue(
    rawIds: unknown,
    heldUntil: number | null,
    heights?: ReadonlyMap<string, number>,
  ): { result: ConvertResult; added: number } {
    const byItself = heldUntil !== null;
    const ids = idsSchema.safeParse(rawIds);
    if (!ids.success) return { result: { ok: false, message: 'Choose the files to convert.' }, added: 0 };
    if (!byItself && !this.deps.ffmpegPath())
      return {
        result: {
          ok: false,
          message: 'Drashti’s copy of FFmpeg is missing, so it cannot convert. Install Drashti again.',
        },
        added: 0,
      };
    let added = 0;
    let going = 0;
    let capChanged = false;
    const findCopy = heights?.size ? copyFinder(this.deps.db) : null;
    for (const requestedId of new Set(ids.data)) {
      const maxHeight = heights?.get(requestedId);
      const id = maxHeight === undefined ? requestedId : (findCopy?.(requestedId) ?? requestedId);
      const row = this.row(id);
      if (!row || row.deleted) continue;
      if (maxHeight === undefined && row.playable !== 0 && !isHevc(row.format)) continue;
      if (maxHeight !== undefined && row.kind !== 'video') continue;
      const pending = this.jobs.find(
        (j) => j.mediaId === id && (j.state === 'waiting' || j.state === 'converting'),
      );
      if (pending) {
        if (maxHeight !== undefined && (pending.maxHeight ?? Infinity) > maxHeight) {
          pending.maxHeight = maxHeight;
          capChanged = true;
          const running = this.running;
          if (running?.job === pending && !running.stop) {
            running.stop = 'wait';
            running.child?.kill();
          }
        }
        going++;
        continue;
      }
      // Converted already (and not undone): everything uses the copy. What uses the original since (an import made
      // it again: a folder playlist looking again, the same file dropped again, Session 50) is moved to the copy too.
      // A copy deleted from the library since (Session 51) stands for nothing: the original is converted again.
      const done = this.deps.db
        .prepare(
          `SELECT mc.id, mc.converted_id, mc.moved FROM media_conversions mc JOIN media c ON c.id = mc.converted_id
            WHERE mc.original_id = ? AND mc.undone_at IS NULL AND c.deleted_at IS NULL
            ORDER BY mc.created_at DESC, mc.rowid DESC LIMIT 1`,
        )
        .get(id) as { id: string; converted_id: string; moved: string } | undefined;
      if (done) {
        this.followCopy(id, done);
        continue;
      }
      const job: ConversionJob = {
        id: randomUUID(),
        mediaId: id,
        name: row.name,
        state: 'waiting',
        progress: null,
        note: null,
        message: null,
        convertedId: null,
        convertedName: null,
        conversionId: null,
        ...(byItself ? { byItself: true } : {}),
        ...(maxHeight === undefined ? {} : { maxHeight }),
      };
      this.jobs.push(job);
      if (heldUntil !== null) this.heldUntil.set(job.id, heldUntil);
      added++;
    }
    // Asked again for files being converted (Session 50: an import may have started them): they are.
    if (added === 0 && going === 0)
      return {
        result: {
          ok: false,
          message: 'Those files play as they are, or are converted already, or being converted.',
        },
        added,
      };
    if (added > 0 || capChanged) {
      this.changed();
      this.watch();
    }
    return { result: { ok: true, jobs: this.list() }, added };
  }

  /** Try an automatic conversion again without turning it into a manual conversion. */
  retryImported(rawId: unknown): ConvertResult {
    const job = this.jobs.find(
      (job) =>
        job.id === rawId &&
        (job.byItself === true || job.maxHeight !== undefined) &&
        job.state === 'failed' &&
        job.retryable,
    );
    if (!job) return { ok: false, message: 'This conversion is no longer available to retry.' };
    const heights = job.maxHeight === undefined ? undefined : new Map([[job.mediaId, job.maxHeight]]);
    return this.enqueue([job.mediaId], Date.now(), heights).result;
  }

  /** Stop only the background sizing of a linked video. Its imported original stays. */
  cancelLinkConversion(rawId: unknown): ConvertResult {
    const job = this.jobs.find(
      (job) =>
        job.id === rawId &&
        job.maxHeight !== undefined &&
        (job.state === 'waiting' || job.state === 'converting'),
    );
    return job ? this.cancel(job.id) : { ok: false, message: 'This link conversion is no longer running.' };
  }

  /** Cancel one job (or, with null, every one not finished). */
  cancel(rawId: unknown): ConvertResult {
    const id = rawId === null ? null : z.string().max(100).safeParse(rawId);
    for (const job of this.jobs) {
      if (job.state !== 'waiting' && job.state !== 'converting') continue;
      if (id !== null && (!id.success || job.id !== id.data)) continue;
      if (this.running?.job === job) {
        this.running.stop = 'cancel';
        this.running.child?.kill();
      } else job.state = 'cancelled';
      this.heldUntil.delete(job.id);
    }
    this.changed();
    return { ok: true, jobs: this.list() };
  }

  /**
   * What uses an original converted already is moved to its copy (Session 50, section 9's review), and added to what
   * the conversion's Undo moves back.
   */
  private followCopy(
    originalId: string,
    done: { id: string; converted_id: string; moved: string },
    said = 'A file converted already was used again: what uses it now uses its copy',
  ): void {
    const db = this.deps.db;
    const more = moveMedia(db, originalId, done.converted_id);
    const lists = Object.values(more) as (string[] | undefined)[];
    if (lists.every((ids) => !ids || ids.length === 0)) return;
    let was: Moved;
    try {
      was = movedSchema.parse(JSON.parse(done.moved));
    } catch {
      was = { cues: [], items: [], kirtans: [], elements: [], props: [], themes: [] };
    }
    const merged: Moved = {
      cues: [...was.cues, ...more.cues],
      items: [...was.items, ...more.items],
      kirtans: [...was.kirtans, ...more.kirtans],
      elements: [...was.elements, ...more.elements],
      props: [...was.props, ...more.props],
      themes: [...was.themes, ...more.themes],
      tracks: [...(was.tracks ?? []), ...(more.tracks ?? [])],
    };
    db.prepare('UPDATE media_conversions SET moved = ? WHERE id = ?').run(JSON.stringify(merged), done.id);
    this.deps.log('info', said);
    this.deps.libraryChanged(presentationsMoved(db, more));
  }

  /** Undo a conversion: everything that was moved to the copy goes back to the original. */
  undo(rawId: unknown): { ok: true } | { ok: false; message: string } {
    const id = z.string().max(100).safeParse(rawId);
    if (!id.success) return { ok: false, message: 'That conversion is not known.' };
    const row = this.deps.db
      .prepare('SELECT original_id, converted_id, moved, undone_at FROM media_conversions WHERE id = ?')
      .get(id.data) as
      { original_id: string; converted_id: string; moved: string; undone_at: string | null } | undefined;
    if (!row) return { ok: false, message: 'That conversion is not known.' };
    if (row.undone_at !== null) return { ok: false, message: 'That conversion was already undone.' };
    let moved: Moved;
    try {
      moved = movedSchema.parse(JSON.parse(row.moved));
    } catch {
      return { ok: false, message: 'That conversion cannot be undone.' };
    }
    moveBack(this.deps.db, moved, row.original_id, row.converted_id);
    this.deps.db
      .prepare("UPDATE media_conversions SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(id.data);
    this.deps.log('info', 'A conversion was undone: the original is used again');
    this.deps.libraryChanged(presentationsMoved(this.deps.db, moved));
    return { ok: true };
  }

  private waitFor(waitForShow: boolean): string | null {
    return (
      this.deps.busy() ??
      (waitForShow && this.deps.showBusy?.()
        ? 'Waits while the show is on, then carries on by itself.'
        : null)
    );
  }

  /** Stop an attempt as soon as the show, stream or recording starts. */
  activityChanged(): void {
    if (this.running) this.pauseForActivity(this.running, true);
    if (this.runningFile) this.pauseForActivity(this.runningFile, this.runningFile.job.waitForShow);
  }

  private pauseForActivity(running: Running | RunningFile, waitForShow: boolean): Stop | null {
    if (!running.stop && this.waitFor(waitForShow) !== null) {
      running.stop = 'wait';
      running.child?.kill();
    }
    return running.stop;
  }

  private watch(): void {
    if (this.closed) return;
    const busy = this.waitFor(true);
    if (this.followAtStart && !busy) {
      this.followAtStart = false;
      this.followStanding();
    }
    this.activityChanged();
    const file = this.runningFile;
    if (file) {
      if (file.child && !file.stop && this.deps.freeBytes(dirname(file.job.dest)) < KEEP_FREE_BYTES) {
        file.stop = 'space';
        file.child.kill();
      }
      return;
    }
    const running = this.running;
    if (running) {
      if (running.child && !running.stop && this.deps.freeBytes(this.deps.mediaDir) < KEEP_FREE_BYTES) {
        running.stop = 'space';
        running.child.kill();
      }
      return;
    }
    const next = this.jobs.find((j) => j.state === 'waiting');
    if (!next || busy) {
      if (next && next.note !== busy) {
        for (const j of this.jobs) if (j.state === 'waiting') j.note = busy;
        this.changed();
      }
      this.nextFile();
      return;
    }
    // One an import found waits its moment after the import (Session 50); the timer looks again.
    const now = Date.now();
    const ready = this.jobs.find((j) => j.state === 'waiting' && (this.heldUntil.get(j.id) ?? 0) <= now);
    if (!ready) return;
    this.heldUntil.delete(ready.id);
    void this.run(ready);
  }

  /** Convert one file; false when it failed. */
  private async run(job: ConversionJob): Promise<boolean> {
    const ffmpeg = this.deps.ffmpegPath();
    const row = this.row(job.mediaId);
    const fail = (message: string, retryable = false): false => {
      job.state = 'failed';
      job.message = message;
      job.retryable = retryable;
      job.progress = null;
      this.running = null;
      this.deps.log('warn', `Conversion failed: ${message}`);
      this.changed();
      this.watch();
      return false;
    };
    if (!ffmpeg) return fail('Drashti’s copy of FFmpeg is missing. Install Drashti again.', false);
    if (!row) return fail('That file is no longer in the library.', false);
    // Deleted from the library while it waited (Session 51 review): let go, never converted.
    if (row.deleted === 1) {
      job.state = 'cancelled';
      job.progress = null;
      this.deps.log('info', 'A file deleted from the library while its conversion waited is not converted');
      this.changed();
      this.watch();
      return false;
    }
    const source = join(this.deps.mediaDir, row.path);
    if (!existsSync(source)) return fail('The file is missing from Drashti’s media folder.', false);
    const size = statSync(source).size;
    const free = this.deps.freeBytes(this.deps.mediaDir);
    if (free - size < KEEP_FREE_BYTES)
      return fail(
        `Only ${gb(free)} is free on the disk, and Drashti keeps 2 GB free. Free up some space, then convert again.`,
        true,
      );
    const running: Running = { job, child: null, tmp: null, stop: null, limitMs: 0 };
    this.running = running;
    job.state = 'converting';
    job.note = null;
    job.message = null;
    job.progress = 0;
    this.changed();

    let probePid: number | undefined;
    const info = await readInfo(ffmpeg, source, {
      timeoutMs: this.probeMs(),
      onSpawn: (probe) => {
        running.child = probe;
        probePid = probe.pid;
        this.deps.children?.started(probe.pid);
      },
    });
    this.deps.children?.ended(probePid);
    running.child = null;
    this.pauseForActivity(running, true);
    if (running.stop) return this.stopped(running, running.stop);
    if (info.timedOut) return fail(probeTooLong(this.probeMs()));
    const { maxHeight } = job;
    if (maxHeight !== undefined) {
      const video = info.video;
      if (!video || video.still)
        return fail('FFmpeg could not find a video to make smaller. Check the downloaded file.');
      if (video.height <= maxHeight && row.playable === 1) {
        // A copy made since the import can already fit. Keep using it.
        job.state = 'done';
        job.progress = 1;
        this.running = null;
        this.changed();
        this.watch();
        return true;
      }
    }
    const target = chooseTarget(row.kind, info);
    if (!target) return fail('FFmpeg could not read anything in this file to convert.', false);
    const work = join(this.deps.mediaDir, CONVERTING_DIR);
    mkdirSync(work, { recursive: true });
    const tmp = join(work, `${job.id}.${TARGET_EXT[target]}`);
    running.tmp = tmp;
    const child = spawn(ffmpeg, convertArgs(target, source, tmp, info, { maxHeight }), {
      windowsHide: true,
      env: ffmpegEnv(),
    });
    running.child = child;
    this.deps.children?.started(child.pid, tmp);
    running.limitMs = this.workMs(info.durationMs);
    const limit = setTimeout(() => {
      running.stop ??= 'time';
      child.kill('SIGKILL');
    }, running.limitMs);
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here: it runs at normal priority.
    }
    const lines: string[] = [];
    const reader = new ProgressReader(
      (p) => {
        if (info.durationMs && p.outTimeMs !== null) {
          job.progress = Math.max(0, Math.min(1, p.outTimeMs / info.durationMs));
          this.changed();
        }
      },
      (line) => {
        lines.push(line);
        if (lines.length > 10) lines.shift();
      },
    );
    child.stderr.on('data', (d: Buffer) => {
      reader.push(d.toString());
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('error', () => {
        resolve(-1);
      });
      child.on('exit', resolve);
    });
    clearTimeout(limit);
    this.deps.children?.ended(child.pid);
    running.child = null;
    const stopped = this.pauseForActivity(running, true);
    if (code !== 0 || stopped) {
      removeQuietly(tmp);
      if (stopped) return this.stopped(running, stopped);
      return fail(
        `FFmpeg could not convert it${lines.length > 0 ? ` (${lines.at(-1) ?? ''})` : ''}. Check the original in another player and import a fresh copy if needed.`,
      );
    }
    try {
      const digest = await sha256File(tmp);
      const stopped = this.pauseForActivity(running, true);
      if (stopped) {
        removeQuietly(tmp);
        return this.stopped(running, stopped);
      }
      this.store(job, row, target, tmp, digest);
      return true;
    } catch (error) {
      removeQuietly(tmp);
      const stopped = this.pauseForActivity(running, true);
      if (stopped) return this.stopped(running, stopped);
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      return fail(
        `The converted file could not be kept. ${fileProblem(error, 'own')}`,
        code === 'ENOSPC' || code === 'EBUSY',
      );
    }
  }

  /** The file was stopped before it finished. Put interrupted work back in the queue. */
  private stopped(running: Running, stop: Stop): false {
    const job = running.job;
    this.running = null;
    job.progress = null;
    if (stop === 'cancel' || stop === 'quit') job.state = 'cancelled';
    else if (stop === 'wait') {
      job.state = 'waiting';
      job.note = this.waitFor(true);
      if (job.note !== null)
        this.deps.log('info', 'A conversion paused for the show or stream: it starts again afterwards');
    } else if (stop === 'time') {
      job.state = 'failed';
      job.retryable = true;
      job.message = `Stopped: converting it took longer than ${spoken(running.limitMs)} (four times its length, and 5 minutes more), so FFmpeg may be stuck. Convert it again; if it stops again, the file may be damaged.`;
      this.deps.log('warn', 'A conversion took longer than its time limit and was stopped');
    } else {
      job.state = 'failed';
      job.retryable = true;
      job.message = `Stopped: the disk has less than 2 GB free (${gb(this.deps.freeBytes(this.deps.mediaDir))}). Free up some space, then convert again.`;
      this.deps.log('warn', 'A conversion stopped: less than 2 GB free');
    }
    this.changed();
    // The timer starts it again once the show and stream are idle.
    if (stop !== 'wait') this.watch();
    return false;
  }

  /** Keep the converted file in the media folder, and move everything over to it. */
  private store(
    job: ConversionJob,
    row: MediaRow,
    target: ConvertTarget,
    tmp: string,
    { sha256, bytes }: Awaited<ReturnType<typeof sha256File>>,
  ): void {
    const ext = TARGET_EXT[target];
    const rel = MediaStore.storedPath(sha256, ext);
    const dest = join(this.deps.mediaDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    if (existsSync(dest)) removeQuietly(tmp);
    else renameSync(tmp, dest);
    const db = this.deps.db;
    const base = basename(row.name, extname(row.name));
    const size = job.maxHeight === undefined ? '' : ` (${String(job.maxHeight)}p)`;
    const name = `${base}${size}.${ext}`;
    const existing = db.prepare('SELECT id, name FROM media WHERE sha256 = ?').get(sha256) as
      { id: string; name: string } | undefined;
    const convertedId = existing?.id ?? randomUUID();
    const conversionId = randomUUID();
    // The original's start and end points and markers, and whether it came from the drop folder (Session 50): the
    // copy keeps them, so everything relinked to it plays as it did (the copy's timing is the original's).
    const kept = db.prepare('SELECT markers, dropped_at FROM media WHERE id = ?').get(row.id) as
      { markers: string | null; dropped_at: string | null } | undefined;
    const moved = db.transaction(() => {
      // The same bytes deleted from the library before (Session 26a): back, with its file.
      if (existing)
        db.prepare(
          "UPDATE media SET deleted_at = NULL, path = ?, missing = 0 WHERE id = ? AND (deleted_at IS NOT NULL OR path = '')",
        ).run(rel, existing.id);
      if (existing && kept?.markers)
        db.prepare('UPDATE media SET markers = ? WHERE id = ? AND markers IS NULL').run(
          kept.markers,
          existing.id,
        );
      if (!existing)
        db.prepare(
          `INSERT INTO media (id, kind, name, path, sha256, bytes, playable, format, converted_from, source_kind, source_path,
             markers, dropped_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'media', ?, ?, ?)`,
        ).run(
          convertedId,
          KIND_OF[target],
          name,
          rel,
          sha256,
          bytes,
          TARGET_FORMAT[target],
          row.id,
          row.source_path,
          kept?.markers ?? null,
          kept?.dropped_at ?? null,
        );
      const m = moveMedia(db, row.id, convertedId);
      // Converted again (its copy deleted since, Session 51 review): the conversions before stand no more, so this
      // one's Undo puts the original back (the same bytes bring the deleted copy back, under one of them).
      db.prepare(
        "UPDATE media_conversions SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE original_id = ? AND undone_at IS NULL",
      ).run(row.id);
      db.prepare(
        'INSERT INTO media_conversions (id, original_id, converted_id, moved) VALUES (?, ?, ?, ?)',
      ).run(conversionId, row.id, convertedId, JSON.stringify(m));
      return m;
    })();
    job.state = 'done';
    job.progress = 1;
    job.convertedId = convertedId;
    job.convertedName = existing?.name ?? name;
    job.conversionId = conversionId;
    this.running = null;
    this.deps.log('info', `Converted a ${KIND_OF[target]} (${TARGET_FORMAT[target]})`);
    this.deps.libraryChanged(presentationsMoved(db, moved));
    this.changed();
    this.watch();
  }

  // ---- making a file no taller than a height (Session 25b) -----------------------------

  /**
   * Make a video taller than `maxHeight` that tall, as a copy in `outDir` with the same name (H.264 and
   * AAC in MP4), one file at a time with the library's own conversions. The conversion waits while the
   * show, stream or recording is on. The original is never changed. A video no taller already needs no copy.
   */
  async fitHeight(source: string, outDir: string, options: FitOptions): Promise<FitResult> {
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg)
      return {
        ok: false,
        message:
          'Drashti’s copy of FFmpeg is missing, so it cannot make the video smaller. Install Drashti again.',
      };
    const info = await readInfo(ffmpeg, source, { timeoutMs: this.probeMs() });
    if (info.timedOut) return { ok: false, message: probeTooLong(this.probeMs()) };
    if (!info.video || info.video.still)
      return {
        ok: false,
        message:
          'FFmpeg could not find a video in it to make smaller: check that it plays as a video, then import it again.',
      };
    if (info.video.height <= options.maxHeight) return { ok: true, copy: null };
    const dest = join(outDir, basename(source, extname(source)) + '.mp4');
    return new Promise((resolve) => {
      this.files.push({
        id: randomUUID(),
        waitForShow: true,
        source,
        dest,
        info,
        options,
        copy: null,
        note: null,
        resolve,
      });
      this.watch();
    });
  }

  /**
   * Save a video's part as `dest` (Session 26e), copying its streams by `copy.args`: queued with the
   * library's conversions. Its id (to stop it), and how it ended: the file saved (never over one already
   * there: a free name next to it then), or why not.
   */
  saveCopy(
    source: string,
    dest: string,
    info: MediaInfo,
    copy: CopyOptions,
  ): { id: string; done: Promise<FitResult> } {
    const id = randomUUID();
    const options: FitOptions = {
      maxHeight: 0,
      progress: (fraction) => {
        copy.progress?.(fraction);
      },
      waiting: (note) => {
        copy.waiting?.(note);
      },
    };
    const done = new Promise<FitResult>((resolve) => {
      this.files.push({
        id,
        waitForShow: copy.waitForShow === true,
        source,
        dest,
        info,
        options,
        copy,
        note: null,
        resolve,
      });
      this.watch();
    });
    return { id, done };
  }

  /** Stop a part being saved (or waiting to be): nothing is left of it. False when there is none such. */
  cancelFile(id: string): boolean {
    const waiting = this.files.findIndex((f) => f.id === id);
    if (waiting >= 0) {
      const [job] = this.files.splice(waiting, 1);
      job?.resolve({ ok: false, message: 'Stopped.', stopped: true });
      return true;
    }
    const running = this.runningFile;
    if (running?.job.id !== id) return false;
    running.stop = 'cancel';
    running.child?.kill();
    return true;
  }

  /** Start the first file eligible under its show and stream gates. */
  private nextFile(): void {
    let ready = -1;
    for (const [at, job] of this.files.entries()) {
      const note = this.waitFor(job.waitForShow);
      if (note === null) {
        if (ready < 0) ready = at;
      } else if (note !== job.note) {
        job.note = note;
        job.options.waiting?.(note);
      }
    }
    if (ready < 0) return;
    const [job] = this.files.splice(ready, 1);
    if (job) void this.runFile(job);
  }

  /** Reserve the estimated output size, with 50% headroom for a part with a higher bitrate. */
  trimSpaceProblem(source: string, out: string, durationMs: number | null, lengthMs: number): string | null {
    const fraction = durationMs !== null && durationMs > 0 ? Math.min(1, (lengthMs / durationMs) * 1.5) : 1;
    return this.fileSpaceProblem(source, out, fraction, 'save it');
  }

  private fileSpaceProblem(
    source: string,
    out: string,
    fraction: number,
    action: 'save it' | 'import it',
  ): string | null {
    const size = statSync(source, { throwIfNoEntry: false })?.size ?? 0;
    const free = this.deps.freeBytes(out);
    return free - Math.ceil(size * fraction) < KEEP_FREE_BYTES
      ? `Only ${gb(free)} is free on this disk, and Drashti keeps 2 GB free. Free up some space, then ${action} again.`
      : null;
  }

  private async runFile(job: FileJob): Promise<void> {
    const ffmpeg = this.deps.ffmpegPath();
    const height = String(job.options.maxHeight);
    const saving = job.copy !== null;
    const what = saving ? 'saved as an MP4' : `made ${height}p`;
    const done = (result: FitResult) => {
      this.runningFile = null;
      job.resolve(result);
      this.watch();
    };
    if (!ffmpeg) {
      done({ ok: false, message: 'Drashti’s copy of FFmpeg is missing. Install Drashti again.' });
      return;
    }
    if (job.note !== null) {
      job.note = null;
      job.options.waiting?.(null);
    }
    const out = dirname(job.dest);
    try {
      mkdirSync(out, { recursive: true });
    } catch {
      done({ ok: false, message: 'Drashti could not write in its own folder: ask the admin.' });
      return;
    }
    const space = job.copy
      ? this.trimSpaceProblem(job.source, out, job.info.durationMs, job.copy.lengthMs)
      : this.fileSpaceProblem(job.source, out, 1, 'import it');
    if (space) {
      done({ ok: false, message: space });
      return;
    }
    const tmp = join(out, `.${job.id}.mp4`);
    const lengthMs = job.copy ? job.copy.lengthMs : job.info.durationMs;
    const running: RunningFile = { job, child: null, tmp, stop: null, limitMs: this.workMs(lengthMs) };
    this.runningFile = running;
    job.options.progress?.(0);
    const child = spawn(
      ffmpeg,
      job.copy
        ? job.copy.args(tmp)
        : convertArgs('mp4', job.source, tmp, job.info, { maxHeight: job.options.maxHeight }),
      { windowsHide: true, env: ffmpegEnv() },
    );
    running.child = child;
    this.deps.children?.started(child.pid, tmp);
    const limit = setTimeout(() => {
      running.stop ??= 'time';
      child.kill('SIGKILL');
    }, running.limitMs);
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here: it runs at normal priority.
    }
    // What FFmpeg says when it fails (a stream an MP4 cannot hold, say), for the log's reason.
    let said = '';
    const reader = new ProgressReader(
      (p) => {
        if (lengthMs && p.outTimeMs !== null)
          job.options.progress?.(Math.max(0, Math.min(1, p.outTimeMs / lengthMs)));
      },
      (line) => {
        if (said.length < 2000) said += `${line}\n`;
      },
    );
    child.stderr.on('data', (d: Buffer) => {
      reader.push(d.toString());
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('error', () => {
        resolve(-1);
      });
      child.on('exit', resolve);
    });
    clearTimeout(limit);
    this.deps.children?.ended(child.pid);
    running.child = null;
    const stop = this.pauseForActivity(running, job.waitForShow);
    if (code !== 0 || stop) {
      removeQuietly(tmp);
      if (stop === 'wait') {
        // It starts again from the beginning once it is safe.
        this.runningFile = null;
        this.files.unshift(job);
        this.deps.log(
          'info',
          `A video waiting to be ${what} paused for the show or stream: it starts again afterwards`,
        );
        this.watch();
        return;
      }
      if (stop === 'quit') {
        done({ ok: false, message: 'Stopped: Drashti is quitting.', stopped: true });
        return;
      }
      if (stop === 'cancel') {
        this.deps.log('info', `A video being ${what} was stopped`);
        done({ ok: false, message: 'Stopped.', stopped: true });
        return;
      }
      if (stop === 'time') {
        this.deps.log('warn', `A video being ${what} took longer than its time limit and was stopped`);
        done({
          ok: false,
          message: `Stopped: ${saving ? 'saving it' : `making it ${height}p`} took longer than ${spoken(running.limitMs)} (four times its length, and 5 minutes more), so FFmpeg may be stuck. Try again; if it stops again, the file may be damaged.`,
        });
        return;
      }
      // A stream an MP4 cannot hold (the check before is by the first picture and sound only).
      const unheld = /not currently supported in container|Could not find tag for codec/u.test(said);
      this.deps.log(
        'warn',
        `A video could not be ${what} (${stop === 'space' ? 'less than 2 GB free' : unheld ? 'a stream an MP4 cannot hold' : 'FFmpeg failed'})`,
      );
      done({
        ok: false,
        message:
          stop === 'space'
            ? `Stopped: this disk has less than 2 GB free. Free up some space, then ${saving ? 'save it' : 'import it'} again.`
            : unheld
              ? 'One of its streams is of a kind an MP4 cannot hold, so it cannot be saved as an MP4 without converting it.'
              : saving
                ? 'FFmpeg could not save it as an MP4.'
                : `FFmpeg could not make it ${height}p.`,
      });
      return;
    }
    // Never over a file already there: one that came since it was named gets a free name beside it.
    const dest = saving
      ? join(dirname(job.dest), freeFileName(dirname(job.dest), basename(job.dest)))
      : job.dest;
    try {
      // Publish a show-gated copy in the same turn as the last activity check.
      if (job.waitForShow) renameSync(tmp, dest);
      else await rename(tmp, dest);
    } catch {
      removeQuietly(tmp);
      done({
        ok: false,
        message: saving
          ? 'Drashti could not save it there: choose another folder.'
          : 'Drashti could not keep the smaller copy: ask the admin.',
      });
      return;
    }
    this.deps.log(
      'info',
      saving ? 'A video’s part was saved as an MP4' : `A video was made ${height}p for its import`,
    );
    job.options.progress?.(1);
    done({ ok: true, copy: dest });
  }

  /**
   * Stop (Drashti is quitting): a conversion going is let go of, its part-file removed. What was waiting or going
   * on stays kept, to start again at the next start (Session 51).
   */
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const f of this.files.splice(0)) f.resolve({ ok: false, message: 'Stopped: Drashti is quitting.' });
    const file = this.runningFile;
    if (file) {
      file.stop = 'quit';
      file.child?.kill();
      removeQuietly(file.tmp);
    }
    const running = this.running;
    if (running) {
      running.stop = 'quit';
      running.child?.kill();
      if (running.tmp) removeQuietly(running.tmp);
    }
  }
}
