import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import type { KeyframeResult, SaveJob, SaveRequest, SaveResult } from '../../shared/trim';
import type { CopyOptions, FitResult } from './convert-service';
import type { MediaInfo } from './plan';
import { freeFileName, keyframeArgs, mp4Problem, readKeyframes, savedFileName, trimArgs } from './trim';

/*
 * Save as MP4… (Session 26e): a video's part between its start and end, as
 * a file of its own where the operator chooses, copied as it is from the
 * keyframe at or before the start (main/convert/trim.ts), run by the
 * conversions (convert-service.ts saveCopy), and Also add it to the library
 * when ticked. The jobs are for the status bar and the dialog.
 */

export interface TrimSavesDeps {
  /** A video Drashti has, there to play: its file and its name; null otherwise. */
  video(mediaId: string): { path: string; name: string } | null;
  ffmpegPath(): string | null;
  readInfo(file: string): Promise<MediaInfo>;
  /** Where to save it: a save dialog with this name to begin with (null: closed). */
  pickDest(defaultName: string): Promise<string | null>;
  saveCopy(
    source: string,
    dest: string,
    info: MediaInfo,
    copy: CopyOptions,
  ): { id: string; done: Promise<FitResult> };
  cancelFile(id: string): boolean;
  /** The normal import of the saved file (Also add it to the library). */
  importFile(path: string): Promise<boolean>;
  changed(jobs: SaveJob[]): void;
  log(level: 'info' | 'warn', message: string): void;
  /** Tests only: read no faster than it plays, so a save is still going when a test quits. */
  readRate?: boolean;
}

/** How many ended saves the list keeps. */
const KEEP = 10;
/** The longest a keyframe listing may take. */
const LISTING_MS = 15_000;

const MISSING_FFMPEG = 'Drashti’s copy of FFmpeg is missing. Install Drashti again.';

/** The keyframe at or before `atMs` in `file`, by FFmpeg listing keyframes from there and stopped at the first. */
export function keyframeOf(ffmpeg: string, file: string, atMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, keyframeArgs(file, atMs), { windowsHide: true });
    let text = '';
    let settled = false;
    const end = (key: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(key);
    };
    const timer = setTimeout(() => {
      end(null);
    }, LISTING_MS);
    child.stderr.on('data', (d: Buffer) => {
      text += d.toString();
      const [first] = readKeyframes(text).keys;
      // The first keyframe listed is where a copy from there begins.
      if (first !== undefined) end(Math.max(0, Math.min(first, atMs)));
    });
    child.on('error', () => {
      end(null);
    });
    child.on('exit', () => {
      end(readKeyframes(text).keys[0] ?? null);
    });
  });
}

export class TrimSaves {
  private jobs: SaveJob[] = [];

  constructor(private readonly deps: TrimSavesDeps) {}

  list(): SaveJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  /** Where a part saved from `startMs` would begin: the keyframe at or before it. */
  async keyframe(mediaId: string, startMs: number): Promise<KeyframeResult> {
    const video = this.deps.video(mediaId);
    if (!video) return { ok: false, message: 'That video is not in the library to play.' };
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return { ok: false, message: MISSING_FFMPEG };
    if (startMs <= 0) return { ok: true, atMs: 0 };
    const at = await keyframeOf(ffmpeg, video.path, startMs);
    return at === null
      ? { ok: false, message: 'FFmpeg could not find where its clean frames are.' }
      : { ok: true, atMs: at };
  }

  /** Save the part (the operator chooses where): it goes on in the background. */
  async save(request: SaveRequest): Promise<SaveResult> {
    const video = this.deps.video(request.mediaId);
    if (!video) return { ok: false, message: 'That video is not in the library to play.' };
    const ffmpeg = this.deps.ffmpegPath();
    if (!ffmpeg) return { ok: false, message: MISSING_FFMPEG };
    const info = await this.deps.readInfo(video.path);
    const problem = mp4Problem(info);
    if (problem) return { ok: false, message: problem };
    const startMs = request.startMs ?? 0;
    const endMs = request.endMs ?? info.durationMs;
    if (endMs === null || endMs <= startMs)
      return { ok: false, message: 'Its end must come after its start.' };
    const from = startMs > 0 ? await keyframeOf(ffmpeg, video.path, startMs) : 0;
    if (from === null) return { ok: false, message: 'FFmpeg could not find where its clean frames are.' };
    const chosen = await this.deps.pickDest(savedFileName(video.name, endMs - startMs));
    if (chosen === null) return { ok: true, job: null };
    // Never over a file already there (even one the save dialog offered to replace).
    const dest = join(dirname(chosen), freeFileName(dirname(chosen), basename(chosen)));
    const job: SaveJob = {
      id: '',
      mediaId: request.mediaId,
      name: basename(dest),
      state: 'waiting',
      progress: null,
      note: null,
      message: null,
      path: null,
      added: false,
    };
    const update = (change: Partial<SaveJob>) => {
      Object.assign(job, change);
      this.deps.changed(this.list());
    };
    // Ended saves kept to show (the last few), then this one.
    const going = (j: SaveJob) => j.state === 'waiting' || j.state === 'saving';
    this.jobs = [...this.jobs.filter(going), ...this.jobs.filter((j) => !going(j)).slice(-KEEP), job];
    // It can start at once (nothing else going): the job is in the list before it says anything.
    const { id, done } = this.deps.saveCopy(video.path, dest, info, {
      args: (tmp) => trimArgs(video.path, tmp, from, endMs, this.deps.readRate === true),
      lengthMs: endMs - from,
      progress: (fraction) => {
        update({ state: 'saving', progress: fraction, note: null });
      },
      waiting: (note) => {
        update({ state: 'waiting', note });
      },
    });
    job.id = id;
    this.deps.changed(this.list());
    this.deps.log('info', 'A video’s part is being saved as an MP4');
    void done.then(async (result) => {
      if (!result.ok) {
        update({ state: result.stopped ? 'stopped' : 'failed', message: result.message, progress: null });
        return;
      }
      const path = result.copy ?? dest;
      update({ state: 'done', path, name: basename(path), progress: 1, note: null });
      if (request.addToLibrary) update({ added: await this.deps.importFile(path) });
    });
    return { ok: true, job: { ...job } };
  }

  /** Stop a save going (or waiting): nothing of it is left. */
  stop(jobId: string): boolean {
    return this.deps.cancelFile(jobId);
  }
}
