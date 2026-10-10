import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';
import type { ConversionJob, ConvertResult } from '../../shared/convert';
import { isHevc } from '../../shared/convert';
import type { Db } from '../db/database';
import { CONVERTING_DIR, MediaStore, sha256File } from '../import/media-store';
import { ProgressReader } from '../stream/worker/progress';
import {
  chooseTarget,
  convertArgs,
  type ConvertTarget,
  type MediaInfo,
  parseFfmpegInfo,
  TARGET_EXT,
  TARGET_FORMAT,
} from './plan';
import { moveBack, moveMedia, type Moved, presentationsMoved } from './relink';

/*
 * Converting media Drashti cannot play (PLAN.md 4.4), one file at a time,
 * in the background, with FFmpeg at the lowest priority. While the stream
 * is on air or recording a conversion waits (one already going stops and
 * starts again afterwards), and none starts or carries on with less than
 * 2 GB free. The original is never changed or deleted: the converted file
 * goes into the media folder as a media item of its own, and everything
 * that used the original is moved to it (src/main/convert/relink.ts), kept
 * so Undo can move it back. What is on the screens is left alone: it keeps
 * playing the original until it is taken down.
 */

export const KEEP_FREE_BYTES = 2 * 1024 ** 3;

export interface ConvertDeps {
  db: Db;
  mediaDir: string;
  ffmpegPath(): string | null;
  /** Why conversions must wait now (on air, recording), or null. */
  busy(): string | null;
  freeBytes(dir: string): number;
  /** The jobs changed: the operator window is told. */
  changed(jobs: ConversionJob[]): void;
  /** A conversion was made or undone: these presentations' slides are read again; the lists reload. */
  libraryChanged(presentations: string[]): void;
  log(level: 'info' | 'warn', message: string): void;
}

interface MediaRow {
  id: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  path: string;
  source_path: string | null;
}

const idsSchema = z.array(z.string().min(1).max(100)).min(1).max(10_000);
const movedSchema = z.object({
  cues: z.array(z.string()),
  items: z.array(z.string()),
  kirtans: z.array(z.string()),
  elements: z.array(z.string()),
  props: z.array(z.string()),
  themes: z.array(z.string()),
});

const KIND_OF: Record<ConvertTarget, MediaRow['kind']> = {
  mp4: 'video',
  'webm-alpha': 'video',
  jpeg: 'image',
  png: 'image',
  m4a: 'audio',
};

/** What FFmpeg says the file holds (it prints this and stops: there is no output). */
function readInfo(ffmpeg: string, file: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true });
    let text = '';
    child.stderr.on('data', (d: Buffer) => (text += d.toString()));
    child.on('error', () => {
      resolve(parseFfmpegInfo(''));
    });
    child.on('exit', () => {
      resolve(parseFfmpegInfo(text));
    });
  });
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Remove a part-file; one still open (Windows) is left for the next start to clear. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleared at the next start.
  }
}

/** Why a conversion going on was stopped: cancelled, waiting for the stream, or out of disk space. */
type Stop = 'cancel' | 'wait' | 'space';

interface Running {
  job: ConversionJob;
  child: ChildProcess | null;
  tmp: string | null;
  stop: Stop | null;
}

/** Making a file no taller than a height (Session 25b): a downloaded video above 1080p, before its import. */
export interface FitOptions {
  maxHeight: number;
  /** How far it has got (0 to 1), when it can be told. */
  progress?(fraction: number | null): void;
  /** Why it waits (the stream on air or recording), or null when it goes on. */
  waiting?(note: string | null): void;
}

/** The copy made (null: it was no taller already), or why none could be. */
export type FitResult = { ok: true; copy: string | null } | { ok: false; message: string };

interface FileJob {
  id: string;
  source: string;
  dest: string;
  info: MediaInfo;
  options: FitOptions;
  note: string | null;
  resolve(result: FitResult): void;
}

interface RunningFile {
  job: FileJob;
  child: ChildProcess | null;
  tmp: string;
  stop: Stop | null;
}

export class ConvertService {
  private jobs: ConversionJob[] = [];
  private running: Running | null = null;
  /** Files waiting to be made no taller than a height (after the library's own jobs), and the one going. */
  private files: FileJob[] = [];
  private runningFile: RunningFile | null = null;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly deps: ConvertDeps) {
    // Part-files left by a conversion that was going when Drashti stopped.
    removeQuietly(join(deps.mediaDir, CONVERTING_DIR));
    // Every second: start the next file, or make the one going wait (the stream, the disk).
    this.timer = setInterval(() => {
      this.watch();
    }, 1000);
    this.timer.unref();
  }

  list(): ConversionJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  private changed(): void {
    // Finished and cancelled jobs are kept a while for the window to see, then let go.
    if (this.jobs.length > 200)
      this.jobs = this.jobs.filter((j) => j.state === 'waiting' || j.state === 'converting');
    this.deps.changed(this.list());
  }

  private row(id: string): MediaRow | null {
    return (
      (this.deps.db.prepare('SELECT id, kind, name, path, source_path FROM media WHERE id = ?').get(id) as
        MediaRow | undefined) ?? null
    );
  }

  /** Convert these media items (each once, in turn). */
  convert(rawIds: unknown): ConvertResult {
    const ids = idsSchema.safeParse(rawIds);
    if (!ids.success) return { ok: false, message: 'Choose the files to convert.' };
    if (!this.deps.ffmpegPath())
      return {
        ok: false,
        message: 'Drashti’s copy of FFmpeg is missing, so it cannot convert. Install Drashti again.',
      };
    let added = 0;
    for (const id of new Set(ids.data)) {
      const row = this.row(id);
      if (!row) continue;
      // Only what Drashti cannot play: files marked so at import, and HEVC (which the window offers only
      // where this computer cannot play it).
      const kind = this.deps.db.prepare('SELECT playable, format FROM media WHERE id = ?').get(id) as
        { playable: number | null; format: string | null } | undefined;
      if (kind?.playable !== 0 && !isHevc(kind?.format ?? null)) continue;
      const pending = this.jobs.some(
        (j) => j.mediaId === id && (j.state === 'waiting' || j.state === 'converting'),
      );
      if (pending) continue;
      // Converted already (and not undone): everything uses the copy.
      const done = this.deps.db
        .prepare('SELECT 1 FROM media_conversions WHERE original_id = ? AND undone_at IS NULL')
        .get(id);
      if (done) continue;
      this.jobs.push({
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
      });
      added++;
    }
    if (added === 0)
      return {
        ok: false,
        message: 'Those files play as they are, or are converted already, or being converted.',
      };
    this.changed();
    this.watch();
    return { ok: true, jobs: this.list() };
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
    }
    this.changed();
    return { ok: true, jobs: this.list() };
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

  private watch(): void {
    const busy = this.deps.busy();
    const file = this.runningFile;
    if (file) {
      if (busy && file.child && !file.stop) {
        file.stop = 'wait';
        file.child.kill();
      } else if (file.child && !file.stop && this.deps.freeBytes(dirname(file.job.dest)) < KEEP_FREE_BYTES) {
        file.stop = 'space';
        file.child.kill();
      }
      return;
    }
    const running = this.running;
    if (running) {
      if (busy && running.child && !running.stop) {
        // On air or recording: stop, and start this file again afterwards.
        running.stop = 'wait';
        running.child.kill();
      } else if (
        running.child &&
        !running.stop &&
        this.deps.freeBytes(this.deps.mediaDir) < KEEP_FREE_BYTES
      ) {
        running.stop = 'space';
        running.child.kill();
      }
      return;
    }
    const next = this.jobs.find((j) => j.state === 'waiting');
    if (!next) {
      this.nextFile(busy);
      return;
    }
    if (busy) {
      if (next.note !== busy) {
        for (const j of this.jobs) if (j.state === 'waiting') j.note = busy;
        this.changed();
      }
      return;
    }
    void this.run(next);
  }

  /** Convert one file; false when it failed. */
  private async run(job: ConversionJob): Promise<boolean> {
    const ffmpeg = this.deps.ffmpegPath();
    const row = this.row(job.mediaId);
    const fail = (message: string): false => {
      job.state = 'failed';
      job.message = message;
      job.progress = null;
      this.running = null;
      this.deps.log('warn', `Conversion failed: ${message}`);
      this.changed();
      this.watch();
      return false;
    };
    if (!ffmpeg) return fail('Drashti’s copy of FFmpeg is missing.');
    if (!row) return fail('That file is no longer in the library.');
    const source = join(this.deps.mediaDir, row.path);
    if (!existsSync(source)) return fail('The file is missing from Drashti’s media folder.');
    const size = statSync(source).size;
    const free = this.deps.freeBytes(this.deps.mediaDir);
    if (free - size < KEEP_FREE_BYTES)
      return fail(
        `Only ${gb(free)} is free on the disk, and Drashti keeps 2 GB free. Free up some space, then convert again.`,
      );
    const running: Running = { job, child: null, tmp: null, stop: null };
    this.running = running;
    job.state = 'converting';
    job.note = null;
    job.message = null;
    job.progress = 0;
    this.changed();

    const info = await readInfo(ffmpeg, source);
    // Cancelled, or the stream started, while FFmpeg was reading the file.
    const early = running.stop ?? (this.deps.busy() ? 'wait' : null);
    if (early) return this.stopped(running, early);
    const target = chooseTarget(row.kind, info);
    if (!target) return fail('FFmpeg could not read anything in this file to convert.');
    const work = join(this.deps.mediaDir, CONVERTING_DIR);
    mkdirSync(work, { recursive: true });
    const tmp = join(work, `${job.id}.${TARGET_EXT[target]}`);
    running.tmp = tmp;
    const child = spawn(ffmpeg, convertArgs(target, source, tmp, info), { windowsHide: true });
    running.child = child;
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
    if (code !== 0 || running.stop) {
      removeQuietly(tmp);
      if (running.stop) return this.stopped(running, running.stop);
      return fail(`FFmpeg could not convert it${lines.length > 0 ? ` (${lines.at(-1) ?? ''})` : ''}.`);
    }
    try {
      await this.store(job, row, target, tmp);
      return true;
    } catch (error) {
      removeQuietly(tmp);
      return fail(`The converted file could not be kept: ${(error as Error).message}`);
    }
  }

  /** The file was stopped before it was finished: cancelled, made to wait for the stream, or out of space. */
  private stopped(running: Running, stop: Stop): false {
    const job = running.job;
    this.running = null;
    job.progress = null;
    if (stop === 'cancel') job.state = 'cancelled';
    else if (stop === 'wait') {
      job.state = 'waiting';
      job.note = this.deps.busy();
      this.deps.log('info', 'A conversion stopped while the stream is on: it starts again afterwards');
    } else {
      job.state = 'failed';
      job.message = `Stopped: the disk has less than 2 GB free (${gb(this.deps.freeBytes(this.deps.mediaDir))}). Free up some space, then convert again.`;
      this.deps.log('warn', 'A conversion stopped: less than 2 GB free');
    }
    this.changed();
    // Waiting for the stream: the timer starts it again once the stream is off.
    if (stop !== 'wait') this.watch();
    return false;
  }

  /** Keep the converted file in the media folder, and move everything over to it. */
  private async store(job: ConversionJob, row: MediaRow, target: ConvertTarget, tmp: string): Promise<void> {
    const { sha256, bytes } = await sha256File(tmp);
    const ext = TARGET_EXT[target];
    const rel = MediaStore.storedPath(sha256, ext);
    const dest = join(this.deps.mediaDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    if (existsSync(dest)) removeQuietly(tmp);
    else renameSync(tmp, dest);
    const db = this.deps.db;
    const name = `${basename(row.name, extname(row.name))}.${ext}`;
    const existing = db.prepare('SELECT id, name FROM media WHERE sha256 = ?').get(sha256) as
      { id: string; name: string } | undefined;
    const convertedId = existing?.id ?? randomUUID();
    const conversionId = randomUUID();
    const moved = db.transaction(() => {
      if (!existing)
        db.prepare(
          `INSERT INTO media (id, kind, name, path, sha256, bytes, playable, format, converted_from, source_kind, source_path)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'media', ?)`,
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
        );
      const m = moveMedia(db, row.id, convertedId);
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
   * AAC in MP4), one file at a time with the library's own conversions, waiting while the stream is on
   * air or recording. The original is never changed. A video no taller already needs no copy.
   */
  async fitHeight(source: string, outDir: string, options: FitOptions): Promise<FitResult> {
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg)
      return {
        ok: false,
        message:
          'Drashti’s copy of FFmpeg is missing, so it cannot make the video smaller. Install Drashti again.',
      };
    const info = await readInfo(ffmpeg, source);
    if (!info.video || info.video.still)
      return { ok: false, message: 'FFmpeg could not find a video in it to make smaller.' };
    if (info.video.height <= options.maxHeight) return { ok: true, copy: null };
    const dest = join(outDir, basename(source, extname(source)) + '.mp4');
    return new Promise((resolve) => {
      this.files.push({ id: randomUUID(), source, dest, info, options, note: null, resolve });
      this.watch();
    });
  }

  /** Start the next file waiting (none while the stream is on: each says why it waits). */
  private nextFile(busy: string | null): void {
    const next = this.files[0];
    if (!next) return;
    if (busy) {
      for (const f of this.files)
        if (f.note !== busy) {
          f.note = busy;
          f.options.waiting?.(busy);
        }
      return;
    }
    this.files.shift();
    void this.runFile(next);
  }

  private async runFile(job: FileJob): Promise<void> {
    const ffmpeg = this.deps.ffmpegPath();
    const height = String(job.options.maxHeight);
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
    const size = existsSync(job.source) ? statSync(job.source).size : 0;
    const free = this.deps.freeBytes(out);
    if (free - size < KEEP_FREE_BYTES) {
      done({
        ok: false,
        message: `Only ${gb(free)} is free on this computer’s disk, and Drashti keeps 2 GB free. Free up some space, then import it again.`,
      });
      return;
    }
    const tmp = join(out, `.${job.id}.mp4`);
    const running: RunningFile = { job, child: null, tmp, stop: null };
    this.runningFile = running;
    job.options.progress?.(0);
    const child = spawn(
      ffmpeg,
      convertArgs('mp4', job.source, tmp, job.info, { maxHeight: job.options.maxHeight }),
      {
        windowsHide: true,
      },
    );
    running.child = child;
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here: it runs at normal priority.
    }
    const reader = new ProgressReader(
      (p) => {
        if (job.info.durationMs && p.outTimeMs !== null)
          job.options.progress?.(Math.max(0, Math.min(1, p.outTimeMs / job.info.durationMs)));
      },
      () => undefined,
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
    if (code !== 0 || running.stop) {
      removeQuietly(tmp);
      const stop = running.stop;
      if (stop === 'wait') {
        // On air: it starts again from the beginning afterwards.
        this.runningFile = null;
        this.files.unshift(job);
        this.deps.log(
          'info',
          `A video waiting to be made ${height}p stopped while the stream is on: it starts again afterwards`,
        );
        this.watch();
        return;
      }
      if (stop === 'cancel') {
        done({ ok: false, message: 'Stopped: Drashti is quitting.' });
        return;
      }
      this.deps.log(
        'warn',
        `A video could not be made ${height}p (${stop === 'space' ? 'less than 2 GB free' : 'FFmpeg failed'})`,
      );
      done({
        ok: false,
        message:
          stop === 'space'
            ? 'Stopped: this computer’s disk has less than 2 GB free. Free up some space, then import it again.'
            : `FFmpeg could not make it ${height}p.`,
      });
      return;
    }
    try {
      await rename(tmp, job.dest);
    } catch {
      removeQuietly(tmp);
      done({ ok: false, message: 'Drashti could not keep the smaller copy: ask the admin.' });
      return;
    }
    this.deps.log('info', `A video was made ${height}p for its import`);
    job.options.progress?.(1);
    done({ ok: true, copy: job.dest });
  }

  /** Stop (Drashti is quitting): a conversion going is let go of, its part-file removed. */
  close(): void {
    clearInterval(this.timer);
    for (const f of this.files.splice(0)) f.resolve({ ok: false, message: 'Stopped: Drashti is quitting.' });
    const file = this.runningFile;
    if (file?.child) {
      file.stop = 'cancel';
      file.child.kill();
    }
    if (file) removeQuietly(file.tmp);
    const running = this.running;
    if (running?.child) {
      running.stop = 'cancel';
      running.child.kill();
    }
    if (running?.tmp) removeQuietly(running.tmp);
  }
}
