import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat, statfs, utimes } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { pictureStep } from '../../shared/device-pictures';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { BROWSER_PICTURES, PICTURE_TYPES, type PictureInfo, readPictureInfo } from './picture-info';
import type { PreviewSource } from './previews';

/*
 * Pictures for phones and tablets at full quality (Session 54, D1): a picture, or a video's frame, at the width
 * the device draws it (a step of PICTURE_WIDTHS), up to the original and never wider. A picture a browser shows
 * as it is, no wider than the step, is its own file (served in pieces as it is read, never held whole). Anything
 * else is made smaller once by the bundled FFmpeg, in the network worker's own child process, one at a time at
 * the lowest priority, so it never takes from the show; kept as a JPEG (a PNG where it may be see-through), and
 * the folder held to a size, the least recently used going first.
 */

export interface Rendition {
  file: string;
  type: string;
  /** The media file itself (a browser shows it as it is, and it is no wider than the step asked). */
  original: boolean;
}

/** At most this much is kept, all the steps of all the pictures together. */
export const RENDITIONS_MAX_BYTES = 400 * 1024 * 1024;
/** Nothing is made while the disk has less than this free (as recordings, backups and downloads keep). */
export const RENDITIONS_KEEP_FREE_BYTES = 2 * 1024 ** 3;
/** One picture's step is never more than this (FFmpeg's quality setting keeps them far smaller). */
export const RENDITION_MAX_BYTES = 64 * 1024 * 1024;
const QUEUE_MAX = 30;
const TIMEOUT_MS = 30_000;
/**
 * A step FFmpeg could not make (a file it cannot read, a disk nearly full) is not tried again for this long: every
 * phone drawing it asks again every 15 s (D1/D2 review).
 */
export const FAILED_MS = 5 * 60_000;

/** How a picture is made: FFmpeg with these arguments, true when it made the file (a seam for the tests). */
export type RenditionRun = (args: string[]) => Promise<boolean>;

export interface RenditionOptions {
  /** The most kept in the folder (RENDITIONS_MAX_BYTES unless given). */
  maxBytes?: number;
  run?: RenditionRun;
  /** When a step was last used (the tests' own clock). */
  now?: () => number;
  /** The free bytes on the folder's disk, or null when not known (the tests' own disk). */
  freeBytes?: (dir: string) => Promise<number | null>;
}

async function freeBytesOf(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** FFmpeg's arguments for one step of a picture or a video's frame: never wider than the file, turned as shown. */
export function renditionArgs(source: PreviewSource, step: number, out: string): string[] {
  const jpeg = out.endsWith('.jpg');
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    // Only files may be opened (Session 31).
    '-protocol_whitelist',
    'file',
    // A video's frame from a moment in, past any fade from black (as its preview).
    ...(source.kind === 'video' ? ['-ss', '0.5'] : []),
    '-i',
    source.path,
    '-frames:v',
    '1',
    // FFmpeg turns a photo by its EXIF orientation first; the width is then capped at the step.
    '-vf',
    `scale=w='min(iw,${String(step)})':h=-1:flags=lanczos,setsar=1`,
    ...(jpeg ? ['-q:v', '3'] : []),
    out,
  ];
}

function runFfmpeg(ffmpeg: string): RenditionRun {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(ffmpeg, args, { windowsHide: true, stdio: 'ignore', env: ffmpegEnv() });
      try {
        if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // Not allowed here: it runs at normal priority.
      }
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
}

export class RenditionMaker {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = false;
  private readonly pending = new Map<string, Promise<Rendition | null>>();
  /** What the folder holds, by name: read once, then kept as files are made, used and let go. */
  private kept: Map<string, { bytes: number; at: number }> | null = null;
  private readonly infos = new Map<string, Promise<PictureInfo | null>>();
  /** Steps not made, by name, and until when they are not tried again. */
  private readonly failed = new Map<string, number>();
  private readonly run: RenditionRun | null;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly freeBytes: (dir: string) => Promise<number | null>;

  constructor(
    private readonly dir: string,
    ffmpeg: string | null,
    options: RenditionOptions = {},
  ) {
    this.run = options.run ?? (ffmpeg ? runFfmpeg(ffmpeg) : null);
    this.maxBytes = options.maxBytes ?? RENDITIONS_MAX_BYTES;
    this.now = options.now ?? (() => Date.now());
    this.freeBytes = options.freeBytes ?? freeBytesOf;
  }

  /**
   * The picture at the step for `asked` device pixels: the file itself where it will do, else its step (made now
   * if need be); null when it cannot be had now (no FFmpeg, too many waiting, a file FFmpeg cannot read).
   */
  async get(mediaId: string, source: PreviewSource, asked: number): Promise<Rendition | null> {
    const step = pictureStep(asked);
    const s = await stat(source.path).catch(() => null);
    if (!s?.isFile()) return null;
    // Its size and time name this version of the file: a file replaced is made again, never mixed up.
    const version = `${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}`;
    const info = source.kind === 'image' ? await this.info(source.path, version) : null;
    if (info && BROWSER_PICTURES.has(info.format) && info.width <= step)
      return { file: source.path, type: PICTURE_TYPES[info.format], original: true };
    // A picture that may be see-through stays so (a PNG); everything else is a JPEG.
    const png = info?.alpha === true;
    const name = `${mediaId}-${String(step)}-${version}.${png ? 'png' : 'jpg'}`;
    const made: Rendition = {
      file: join(this.dir, name),
      type: png ? 'image/png' : 'image/jpeg',
      original: false,
    };
    if (await this.has(name)) return made;
    const already = this.pending.get(name);
    if (already) return already;
    const run = this.run;
    if (!run || this.queue.length >= QUEUE_MAX || (this.failed.get(name) ?? 0) > this.now()) return null;
    const job = new Promise<Rendition | null>((resolve) => {
      this.queue.push(async () => {
        const ok = await this.make(run, source, step, name);
        if (ok) this.failed.delete(name);
        else {
          if (this.failed.size > 1000) this.failed.clear();
          this.failed.set(name, this.now() + FAILED_MS);
        }
        resolve(ok ? made : null);
      });
      void this.drain();
    }).finally(() => this.pending.delete(name));
    this.pending.set(name, job);
    return job;
  }

  private info(path: string, version: string): Promise<PictureInfo | null> {
    const key = `${path}\n${version}`;
    let found = this.infos.get(key);
    if (!found) {
      found = readPictureInfo(path);
      if (this.infos.size > 2000) this.infos.clear();
      this.infos.set(key, found);
    }
    return found;
  }

  private async index(): Promise<Map<string, { bytes: number; at: number }>> {
    if (this.kept) return this.kept;
    const kept = new Map<string, { bytes: number; at: number }>();
    const names = await readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith('.part.jpg') || name.endsWith('.part.png')) {
        // Left half made by a stop: never served.
        await rm(join(this.dir, name), { force: true }).catch(() => undefined);
        continue;
      }
      const s = await stat(join(this.dir, name)).catch(() => null);
      if (s?.isFile()) kept.set(name, { bytes: s.size, at: s.mtimeMs });
    }
    this.kept ??= kept;
    return this.kept;
  }

  /** Whether the folder holds this step already; using it puts it last to go. */
  private async has(name: string): Promise<boolean> {
    const kept = await this.index();
    const entry = kept.get(name);
    if (!entry) return false;
    const now = this.now();
    entry.at = now;
    // On the disk too, so the order lasts past a restart; a file gone from the folder since is made again.
    try {
      await utimes(join(this.dir, name), now / 1000, now / 1000);
      return true;
    } catch {
      kept.delete(name);
      return false;
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) await job();
    } finally {
      this.running = false;
    }
  }

  private async make(run: RenditionRun, source: PreviewSource, step: number, name: string): Promise<boolean> {
    await mkdir(this.dir, { recursive: true });
    // A nearly full disk is kept for the show: the phone keeps the picture it has.
    const free = await this.freeBytes(this.dir);
    if (free !== null && free < RENDITIONS_KEEP_FREE_BYTES) return false;
    const file = join(this.dir, name);
    const tmp = file.replace(/\.(jpg|png)$/u, '.part.$1');
    const ok = await run(renditionArgs(source, step, tmp));
    const s = ok ? await stat(tmp).catch(() => null) : null;
    if (!s?.isFile() || s.size === 0 || s.size > RENDITION_MAX_BYTES) {
      await rm(tmp, { force: true }).catch(() => undefined);
      return false;
    }
    try {
      await rename(tmp, file);
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined);
      return false;
    }
    const kept = await this.index();
    kept.set(name, { bytes: s.size, at: this.now() });
    await this.prune(kept, name);
    return true;
  }

  /** Over its size: the least recently used go, never the one just made. */
  private async prune(kept: Map<string, { bytes: number; at: number }>, keep: string): Promise<void> {
    let total = 0;
    for (const e of kept.values()) total += e.bytes;
    if (total <= this.maxBytes) return;
    const oldest = [...kept.entries()].filter(([n]) => n !== keep).sort((a, b) => a[1].at - b[1].at);
    for (const [name, entry] of oldest) {
      if (total <= this.maxBytes) break;
      kept.delete(name);
      total -= entry.bytes;
      await rm(join(this.dir, name), { force: true }).catch(() => undefined);
    }
  }
}
