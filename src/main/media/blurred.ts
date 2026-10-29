import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';

/*
 * Blurred copies (Session 55, Part 5, the owner's idea D): a photo that does not fill its screen (a phone's
 * portrait photo on a wide screen) has a blurred, darker copy of itself behind it instead of black bars. A screen
 * never blurs anything itself: a filter over the whole screen cost half a second to a second a change without a
 * graphics chip (PLAN §6, the sharpening row). The copy is made once per picture by the bundled FFmpeg, small
 * (BLUR_SIDE pixels on its long side, already blurred and darker), and every screen draws it stretched over the
 * screen behind the picture: a small picture drawn big is soft by itself, and costs what any picture costs.
 *
 * - Made when a picture is imported, and when one first comes up next or on the screens (the library already
 *   there is never gone through all at once): one at a time, FFmpeg at the lowest priority, never while the
 *   stream is on air or recording (they wait), each given up after BLUR_TIMEOUT_MS.
 * - Kept in the media folder's `blurred/` as `<sha256>.jpg` (the picture's own file's hash), beside the
 *   sharpened copies; left out of backups (any can be made again); removed with the picture for good.
 * - FFmpeg turns a photo by its EXIF orientation first, as the screens do.
 */

export const BLURRED_DIR = 'blurred';
/** The copy's long side, in pixels. */
export const BLUR_SIDE = 128;
/** One copy taking longer than this is given up (and not tried again while Drashti runs). */
export const BLUR_TIMEOUT_MS = 30_000;
/** A picture bigger than this is not read for a copy (it shows on black, as before). */
export const BLUR_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
/** A copy is never bigger than this. */
export const BLUR_MAX_BYTES = 1024 * 1024;

const SHA256 = /^[0-9a-f]{64}$/u;
const COPY_NAME = /^([0-9a-f]{64})\.jpg$/u;

/** FFmpeg's arguments for a picture's blurred, darker copy: small, blurred, a little more than half as bright. */
export function blurArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file',
    '-y',
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    `scale=w=${String(BLUR_SIDE)}:h=${String(BLUR_SIDE)}:force_original_aspect_ratio=decrease:flags=area,gblur=sigma=4,colorchannelmixer=rr=0.55:gg=0.55:bb=0.55`,
    '-q:v',
    '5',
    output,
  ];
}

/** How a copy is made: FFmpeg with these arguments, true when it made the file (a seam for the tests). */
export type BlurRun = (args: string[]) => Promise<boolean>;

/** The bundled FFmpeg, run at the lowest priority, stopped after BLUR_TIMEOUT_MS. */
export function ffmpegBlurRun(ffmpeg: () => string | null): BlurRun {
  return (args) =>
    new Promise((resolve) => {
      const path = ffmpeg();
      if (!path) {
        resolve(false);
        return;
      }
      const child = spawn(path, args, { windowsHide: true, env: ffmpegEnv(), stdio: 'ignore' });
      try {
        if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // Not allowed here: it runs at normal priority, still one at a time.
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, BLUR_TIMEOUT_MS);
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

export interface BlurDeps {
  mediaDir: string;
  /** A picture's own file (relative to the media folder) and its hash; null for anything but a picture there. */
  fileOf(mediaId: string): { sha256: string; path: string } | null;
  run: BlurRun;
  /** The stream is on air or recording: nothing is made meanwhile (Session 50's rule). */
  onAir?: () => boolean;
  /** A copy is ready: the screens look again. */
  changed(): void;
  log(message: string): void;
  /** How long to wait before looking again while on air (tests make it short). */
  retryMs?: number;
}

interface Ready {
  /** The copy's own hash and size (a node copies it by them). */
  hash: string;
  bytes: number;
}

/** A copy's own hash and size, read whole (each is a few kilobytes); null when it cannot be read. */
async function hashOf(file: string): Promise<Ready | null> {
  try {
    const bytes = await readFile(file);
    if (bytes.length === 0 || bytes.length > BLUR_MAX_BYTES) return null;
    return { hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  } catch {
    return null;
  }
}

export class BlurredCopies {
  /** The copies there are, by the picture's sha256. */
  private readonly ready = new Map<string, Ready>();
  private readonly queue: { sha256: string; path: string }[] = [];
  /** Copies that could not be made while Drashti runs. */
  private readonly failed = new Set<string>();
  private scanned: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: BlurDeps) {}

  private get dir(): string {
    return join(this.deps.mediaDir, BLURRED_DIR);
  }

  /** The copies on disk, once, with their hashes (each a few kilobytes). */
  scan(): Promise<void> {
    this.scanned ??= (async () => {
      let names: string[] = [];
      try {
        names = await readdir(this.dir);
      } catch {
        // None made yet.
      }
      for (const name of names) {
        const m = COPY_NAME.exec(name);
        const found = m?.[1] ? await hashOf(join(this.dir, name)) : null;
        if (m?.[1] && found) this.ready.set(m[1], found);
        // A half-written one (a quit while it was being made) goes.
        else if (name.includes('.part-'))
          await rm(join(this.dir, name), { force: true }).catch(() => undefined);
      }
    })();
    return this.scanned;
  }

  /** Whether a picture's file has its blurred copy. */
  has(sha256: string | null): boolean {
    return sha256 !== null && this.ready.has(sha256);
  }

  /** A picture's copy, relative to the media folder, if it is ready. */
  relativePath(sha256: string | null): string | null {
    return sha256 && this.ready.has(sha256) ? `${BLURRED_DIR}/${sha256}.jpg` : null;
  }

  /** A ready copy as a node fetches it: its own hash and size. */
  fileOf(sha256: string | null): { hash: string; bytes: number } | null {
    const r = sha256 ? this.ready.get(sha256) : undefined;
    return r ? { hash: r.hash, bytes: r.bytes } : null;
  }

  /** These pictures want their copies (imported, or coming up): those without one are made, in turn. */
  want(mediaIds: Iterable<string>): void {
    if (this.closed) return;
    let added = false;
    for (const id of mediaIds) {
      const file = this.deps.fileOf(id);
      if (!file || !SHA256.test(file.sha256) || file.path === '' || isAbsolute(file.path)) continue;
      if (this.ready.has(file.sha256) || this.failed.has(file.sha256)) continue;
      if (this.queue.some((q) => q.sha256 === file.sha256)) continue;
      this.queue.push(file);
      added = true;
    }
    if (added) this.start();
  }

  /** Nothing being made or waiting (tests wait for this). */
  async idle(): Promise<void> {
    await this.scan();
    if (!this.running) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private start(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
      // Some came while the last one finished.
      if (this.queue.length > 0 && !this.closed) this.start();
    });
  }

  private async drain(): Promise<void> {
    await this.scan();
    while (!this.closed) {
      const next = this.queue[0];
      if (!next) return;
      if (this.deps.onAir?.()) {
        await new Promise((resolve) => setTimeout(resolve, this.deps.retryMs ?? 5000));
        continue;
      }
      this.queue.shift();
      if (this.ready.has(next.sha256)) continue;
      await this.make(next);
    }
  }

  private async make(file: { sha256: string; path: string }): Promise<void> {
    const source = join(this.deps.mediaDir, file.path);
    const target = join(this.dir, `${file.sha256}.jpg`);
    const partial = `${target}.part-${randomUUID()}.jpg`;
    try {
      const s = await stat(source);
      if (!s.isFile() || s.size > BLUR_MAX_SOURCE_BYTES) throw new Error('no picture to read');
      await mkdir(this.dir, { recursive: true });
      const ok = await this.deps.run(blurArgs(source, partial));
      const made = ok ? await hashOf(partial) : null;
      if (!made) throw new Error('FFmpeg made no copy');
      if (this.closed) throw new Error('Drashti is quitting');
      await rename(partial, target);
      this.ready.set(file.sha256, made);
      this.deps.log(`Blurred copies: one made (${String(made.bytes)} bytes)`);
      this.deps.changed();
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      this.failed.add(file.sha256);
      if (!this.closed) this.deps.log(`Blurred copies: one was not made (${String(error)})`);
    }
  }

  /** Drashti is quitting: nothing more is made. */
  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }
}

/** Remove a picture's blurred copy (it is gone from the library for good). */
export async function removeBlurredOf(mediaDir: string, sha256: string): Promise<void> {
  if (!SHA256.test(sha256)) return;
  await rm(join(mediaDir, BLURRED_DIR, `${sha256}.jpg`), { force: true }).catch(() => undefined);
}
