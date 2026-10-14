import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { sharpenStep } from '../../shared/picture-look';
import { extOf } from '../import/scan';
import { sha256File } from '../import/media-store';

/*
 * Sharpened copies (Session 26f). Sharpening was the screens' own SVG
 * convolution filter, which costs half a second to a second a change on a
 * computer without a graphics chip. Now a picture whose look has Sharpness
 * above 0 gets a sharpened copy, made once, at its own size, with the same
 * kernel (shared/picture-look.ts sharpenPixels), and every screen draws that
 * copy with the rest of its look; until it is ready they draw the picture
 * unsharpened.
 *
 * - Made one at a time in a hidden window of its own (src/renderer/sharpen.html)
 *   whose process runs at the lowest priority, as the PDF pages are drawn:
 *   Chromium decodes the picture as the screens do (its turn, its colours),
 *   draws it on a canvas, sharpens the pixels and hands back a JPEG (from a
 *   JPEG) or a PNG (anything else, which may be see-through). The window goes
 *   when nothing is left to make.
 * - Kept in the media folder's `sharpened/` as `<sha256>-<step>.<ext>`, beside
 *   the stills; never made from anything but the picture's file, never written
 *   anywhere but there.
 * - What is wanted is read from the library each time (refresh): a copy no
 *   picture wants any more (its Sharpness changed, the picture went) goes, and
 *   a wanted one that is not there is made.
 * - Backups leave the folder out: every copy can be made again.
 */

export const SHARPENED_DIR = 'sharpened';

/** A copy is never bigger than this (a picture of the largest size the window takes, as a PNG). */
export const MAX_COPY_BYTES = 512 * 1024 * 1024;
/** A picture bigger than this is not read for a copy (it shows unsharpened). */
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
/** Nor one of more pixels than this (8K is 33 million). */
export const MAX_COPY_PIXELS = 50_000_000;
/** One copy taking longer than this is given up (and not tried again while Drashti runs). */
const JOB_TIMEOUT_MS = 120_000;

const SHA256 = /^[0-9a-f]{64}$/u;
const COPY_NAME = /^([0-9a-f]{64})-(\d{1,3})\.(jpg|png)$/u;

/** A copy's file type: a JPEG from a JPEG (as small, as quick to draw), else a PNG (it keeps see-through parts). */
export const copyExtOf = (originalPath: string): 'jpg' | 'png' => {
  const ext = extOf(originalPath);
  return ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';
};

/** A copy's file name in `sharpened/`. */
export const copyName = (sha256: string, step: number, ext: 'jpg' | 'png'): string =>
  `${sha256}-${String(step)}.${ext}`;

/** A picture that wants a copy: its file (relative to the media folder) and its look's sharpness. */
export interface CopyWant {
  mediaId: string;
  sha256: string;
  path: string;
  sharpness: number;
}

/** What the window is given to make one copy. */
export interface SharpenJob {
  key: string;
  data: Uint8Array;
  /** 5 to 100. */
  percent: number;
  /** What to hand back. */
  type: 'image/jpeg' | 'image/png';
  maxPixels: number;
}

/** The hidden window as the service sees it. */
export interface SharpenWindow {
  /** Its page's id: only it is answered. */
  readonly id: number;
  destroy(): void;
}

export interface SharpenDeps {
  mediaDir: string;
  /** The pictures whose looks have Sharpness above 0, from the library now. */
  wanted(): CopyWant[];
  /** Open the hidden window (its page loaded); `gone` when its process ends unexpectedly. */
  open(gone: () => void): SharpenWindow;
  /** A copy is ready, or one went: the screens and thumbnails look again. */
  changed(): void;
  log(message: string): void;
}

interface Ready {
  step: number;
  ext: 'jpg' | 'png';
  /** The copy's own hash and size, once known (a node copies it by them). */
  hash: string | null;
  bytes: number;
}

interface Job {
  want: CopyWant;
  step: number;
  ext: 'jpg' | 'png';
}

const keyOf = (j: { want: { sha256: string }; step: number; ext: string }) =>
  `${j.want.sha256}-${String(j.step)}.${j.ext}`;

const isPng = (b: Uint8Array) =>
  b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);
const isJpeg = (b: Uint8Array) =>
  b.length > 4 &&
  b[0] === 0xff &&
  b[1] === 0xd8 &&
  b[2] === 0xff &&
  b[b.length - 2] === 0xff &&
  b[b.length - 1] === 0xd9;

export class SharpenedCopies {
  /** The copies there are, by the picture's sha256. */
  private readonly ready = new Map<string, Ready>();
  private queue: Job[] = [];
  /** Copies that could not be made while Drashti runs (tried again once the look changes). */
  private readonly failed = new Set<string>();
  private win: SharpenWindow | null = null;
  /** The window was told nothing is left: its page has stopped asking. */
  private finishing = false;
  private current: { job: Job; timer: NodeJS.Timeout } | null = null;
  private scanned: Promise<void> | null = null;
  private refreshing: Promise<void> = Promise.resolve();
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: SharpenDeps) {}

  private get dir(): string {
    return join(this.deps.mediaDir, SHARPENED_DIR);
  }

  /** The copy of a picture's file at a step, relative to the media folder, if it is ready. */
  relativePath(sha256: string | null, step: number): string | null {
    const r = sha256 ? this.ready.get(sha256) : undefined;
    return sha256 && r?.step === step ? `${SHARPENED_DIR}/${copyName(sha256, step, r.ext)}` : null;
  }

  /** The step of a picture's copy that is ready (0: none). */
  readyStep(sha256: string | null): number {
    return sha256 ? (this.ready.get(sha256)?.step ?? 0) : 0;
  }

  /** A ready copy as a node fetches it: its hash, size and type (null until its hash is known). */
  fileOf(sha256: string | null, step: number): { hash: string; bytes: number; ext: 'jpg' | 'png' } | null {
    const r = sha256 ? this.ready.get(sha256) : undefined;
    return r?.step === step && r.hash ? { hash: r.hash, bytes: r.bytes, ext: r.ext } : null;
  }

  /** Nothing being made or waiting (tests and the performance check wait for this). */
  async idle(): Promise<void> {
    await this.refreshing;
    if (!this.current && this.queue.length === 0 && !this.win) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** The copies on disk (once). Their hashes are worked out afterwards, a file at a time. */
  private scan(): Promise<void> {
    this.scanned ??= (async () => {
      let names: string[] = [];
      try {
        names = await readdir(this.dir);
      } catch {
        // None made yet.
      }
      for (const name of names) {
        const m = COPY_NAME.exec(name);
        if (!m?.[1]) continue;
        // Two of one picture (a refresh will tidy): the first is kept.
        if (this.ready.has(m[1])) continue;
        this.ready.set(m[1], { step: Number(m[2]), ext: m[3] as 'jpg' | 'png', hash: null, bytes: 0 });
      }
      void this.hashAll();
    })();
    return this.scanned;
  }

  private async hashAll(): Promise<void> {
    let found = false;
    for (const [sha, r] of this.ready) {
      if (r.hash) continue;
      const file = join(this.dir, copyName(sha, r.step, r.ext));
      try {
        const { sha256, bytes } = await sha256File(file);
        // Still the same copy (not remade or tidied meanwhile).
        if (this.ready.get(sha) === r) {
          r.hash = sha256;
          r.bytes = bytes;
          found = true;
        }
      } catch {
        if (this.ready.get(sha) === r) this.ready.delete(sha);
      }
    }
    if (found) this.deps.changed();
  }

  /**
   * Read what is wanted again (at start, when a look changed, when media was deleted or came back): copies
   * nothing wants go, missing ones are made.
   */
  refresh(): Promise<void> {
    const run = this.refreshing.then(() => this.refreshNow());
    this.refreshing = run.catch((error: unknown) => {
      this.deps.log(`Sharpened copies: could not look at them (${String(error)})`);
    });
    return this.refreshing;
  }

  private async refreshNow(): Promise<void> {
    await this.scan();
    const jobs: Job[] = [];
    const keep = new Map<string, number>();
    for (const want of this.deps.wanted()) {
      const step = sharpenStep(want.sharpness);
      if (step === 0 || !SHA256.test(want.sha256) || want.path === '' || isAbsolute(want.path)) continue;
      if (keep.has(want.sha256)) continue;
      keep.set(want.sha256, step);
      jobs.push({ want, step, ext: copyExtOf(want.path) });
    }
    // Copies nothing wants go (another step, the picture's sharpness at 0, the picture gone).
    let gone = false;
    for (const [sha, r] of [...this.ready]) {
      if (keep.get(sha) === r.step) continue;
      this.ready.delete(sha);
      gone = true;
      await rm(join(this.dir, copyName(sha, r.step, r.ext)), { force: true }).catch(() => undefined);
    }
    await this.removeStray(keep);
    const making = this.current ? keyOf(this.current.job) : null;
    this.queue = jobs.filter(
      (j) =>
        this.ready.get(j.want.sha256)?.step !== j.step && !this.failed.has(keyOf(j)) && keyOf(j) !== making,
    );
    if (gone) this.deps.changed();
    if (this.queue.length > 0) this.start();
    else this.settle();
  }

  /** Files in the folder that are no copy anyone wants (half-written ones, two of one picture). */
  private async removeStray(keep: Map<string, number>): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = COPY_NAME.exec(name);
      const r = m?.[1] ? this.ready.get(m[1]) : undefined;
      const current = m?.[1] && r && keep.get(m[1]) === r.step && name === copyName(m[1], r.step, r.ext);
      const making = this.current && name.startsWith(`${keyOf(this.current.job)}.part-`);
      if (!current && !making) await rm(join(this.dir, name), { force: true }).catch(() => undefined);
    }
  }

  private start(): void {
    if (this.win && !this.finishing) return;
    // A window whose page has stopped asking is closed; a new one asks again.
    this.win?.destroy();
    this.win = null;
    this.finishing = false;
    try {
      this.win = this.deps.open(() => {
        this.windowGone('its window stopped');
      });
    } catch (error) {
      this.deps.log(`Sharpened copies: the window that makes them could not open (${String(error)})`);
      this.queue = [];
      this.settle();
    }
  }

  private windowGone(why: string): void {
    const c = this.current;
    if (c) {
      clearTimeout(c.timer);
      this.failed.add(keyOf(c.job));
      this.deps.log(`Sharpened copies: one was not made (${why})`);
      this.current = null;
    }
    this.win = null;
    if (this.queue.length > 0) this.start();
    else this.settle();
  }

  private settle(): void {
    if (this.current || this.queue.length > 0) return;
    if (this.win) {
      this.win.destroy();
      this.win = null;
    }
    this.finishing = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  /** The window asks for the next picture (null: none left, and the window goes). */
  async next(senderId: number): Promise<SharpenJob | null> {
    if (this.win?.id !== senderId || this.current) return null;
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      const file = join(this.deps.mediaDir, job.want.path);
      let data: Buffer;
      try {
        const s = await stat(file);
        if (s.size > MAX_SOURCE_BYTES) throw new Error('the picture is over 256 MB');
        data = await readFile(file);
      } catch (error) {
        this.failed.add(keyOf(job));
        this.deps.log(`Sharpened copies: a picture could not be read (${String(error)})`);
        continue;
      }
      const timer = setTimeout(() => {
        const win = this.win;
        this.win = null;
        win?.destroy();
        this.windowGone('it took too long');
      }, JOB_TIMEOUT_MS);
      this.current = { job, timer };
      return {
        key: keyOf(job),
        data: new Uint8Array(data),
        percent: job.step,
        type: job.ext === 'jpg' ? 'image/jpeg' : 'image/png',
        maxPixels: MAX_COPY_PIXELS,
      };
    }
    // Nothing left: the window goes once this answer is back.
    this.finishing = true;
    setTimeout(() => {
      this.settle();
    }, 0);
    return null;
  }

  /** The window hands back a copy (null: it could not make it). */
  async made(senderId: number, key: unknown, bytes: unknown): Promise<boolean> {
    const c = this.current;
    if (this.win?.id !== senderId || !c || key !== keyOf(c.job)) return false;
    clearTimeout(c.timer);
    const { job } = c;
    const ok =
      bytes instanceof Uint8Array &&
      bytes.length <= MAX_COPY_BYTES &&
      (job.ext === 'jpg' ? isJpeg(bytes) : isPng(bytes));
    if (!ok) {
      this.failed.add(keyOf(job));
      this.deps.log('Sharpened copies: one could not be made (the picture could not be drawn)');
    } else {
      await this.keep(job, bytes);
    }
    this.current = null;
    // The window asks for the next one; with none left it goes once this answer is back.
    if (this.queue.length === 0)
      setTimeout(() => {
        this.settle();
      }, 0);
    return true;
  }

  private async keep(job: Job, bytes: Uint8Array): Promise<void> {
    const name = copyName(job.want.sha256, job.step, job.ext);
    const target = join(this.dir, name);
    const partial = `${target}.part-${randomUUID()}`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(partial, bytes);
      // Still wanted (its look may have changed while it was being made).
      const still = this.deps
        .wanted()
        .some((w) => w.sha256 === job.want.sha256 && sharpenStep(w.sharpness) === job.step);
      if (!still) {
        await rm(partial, { force: true });
        return;
      }
      await rename(partial, target);
      const was = this.ready.get(job.want.sha256);
      if (was && was.step !== job.step)
        await rm(join(this.dir, copyName(job.want.sha256, was.step, was.ext)), { force: true }).catch(
          () => undefined,
        );
      this.ready.set(job.want.sha256, {
        step: job.step,
        ext: job.ext,
        hash: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      });
      this.deps.log(`Sharpened copies: one made (${String(job.step)} %, ${String(bytes.length)} bytes)`);
      this.deps.changed();
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      this.failed.add(keyOf(job));
      this.deps.log(`Sharpened copies: one could not be kept (${String(error)})`);
    }
  }

  /** Drashti is quitting: the window goes, nothing more is made. */
  close(): void {
    if (this.current) clearTimeout(this.current.timer);
    this.current = null;
    this.queue = [];
    this.win?.destroy();
    this.win = null;
    this.settle();
  }
}

/** Remove every copy of a picture's file (it is gone from the library for good). */
export async function removeCopiesOf(mediaDir: string, sha256: string): Promise<void> {
  // Hex only: never a path.
  if (!/^[0-9a-f]{1,64}$/u.test(sha256)) return;
  let names: string[];
  try {
    names = await readdir(join(mediaDir, SHARPENED_DIR));
  } catch {
    return;
  }
  for (const name of names)
    if (name.startsWith(`${sha256}-`))
      await rm(join(mediaDir, SHARPENED_DIR, name), { force: true }).catch(() => undefined);
}
