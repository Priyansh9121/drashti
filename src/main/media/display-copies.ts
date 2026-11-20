import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PictureLook, PixelSize } from '../../shared/picture-look';
import { displayPictureSize } from '../../shared/picture-display';
import type { SharpenJobView } from '../../shared/pictures';
import { diskFreeBytes, sha256File } from '../import/media-store';
import { realPlaceAsync } from './contained';
import { pictureHeader, readPictureHeader, type PictureHeader } from './picture-header';

export const DISPLAY_DIR = 'display';
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_COPY_BYTES = 512 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 50_000_000;
const RESERVE_BYTES = 2 * 1024 ** 3;
const JOB_MS = 120_000;
const SHA = /^[a-f0-9]{64}$/u;

export interface DisplayCandidate {
  path: string;
  sha256: string;
  look?: PictureLook | null;
}
export interface DisplayFile {
  key: string;
  width: number;
  height: number;
  path: string;
  hash: string;
  bytes: number;
  ext: 'jpg' | 'png';
}
export type DisplayResult = { ok: true; copy: DisplayFile | null } | { ok: false; message: string };
export interface DisplayDeps {
  mediaDir: string;
  targets(): readonly PixelSize[];
  open(gone: () => void): { id: number; destroy(): void };
  changed(): void;
  log(message: string): void;
  canWork?(): boolean;
  /** Shared picture worker arbitration, for imports and sweeps alike. */
  canStart?(): boolean;
  freeBytes?(): number;
}
interface Job {
  candidate: DisplayCandidate;
  size: PixelSize;
  header: PictureHeader;
  key: string;
  resolve(result: DisplayResult): void;
  result: Promise<DisplayResult>;
  users: number;
  idleOnly: boolean;
}
const failure = (message: string): DisplayResult => ({ ok: false, message });
const keyOf = (sha: string, size: PixelSize) =>
  `p1-${/^[a-f0-9]{32}/u.exec(sha)?.[0] ?? ''}-${String(size.width)}x${String(size.height)}`;
const nameOf = (sha: string, size: PixelSize, ext: string) =>
  `v1-${sha}-${String(size.width)}x${String(size.height)}.${ext}`;

/** Q60-48, owner "Yes, A": an older picture without a ready copy retains its original source. */
function originalForOlderPictureWithoutDisplayCopy(): null {
  return null;
}

/**
 * Private, regenerable still-picture renditions. The original is read only; new imports await prepare(), while
 * the old-library sweep yields between files and never starts a job while the show is busy. One CPU canvas job
 * runs at a time, in the existing low-priority Chromium worker, with its own sender-checked reply routes.
 */
export class DisplayCopies {
  private readonly files = new Map<string, DisplayFile>();
  private readonly sources = new Map<string, PictureHeader>();
  private readonly latest = new Map<string, DisplayFile>();
  private readonly headers = new Map<string, Promise<PictureHeader | null>>();
  private readonly pending = new Map<string, Job>();
  private queue: Job[] = [];
  private win: { id: number; destroy(): void } | null = null;
  private finishing = false;
  private current: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null;
  private stopped = false;
  private sweeping: Promise<void> = Promise.resolve();
  private wake: ReturnType<typeof setTimeout> | null = null;
  private idleWaiters: (() => void)[] = [];
  constructor(private readonly deps: DisplayDeps) {}

  private cancelled(signal?: AbortSignal): boolean {
    return this.stopped || Boolean(signal?.aborted);
  }
  private isCurrent(job: Job): boolean {
    return this.current?.job === job;
  }

  private async header(candidate: DisplayCandidate): Promise<PictureHeader | null> {
    let reading = this.headers.get(candidate.sha256);
    if (!reading) {
      reading = readPictureHeader(join(this.deps.mediaDir, candidate.path));
      this.headers.set(candidate.sha256, reading);
    }
    const header = await reading;
    if (header) this.sources.set(candidate.sha256, header);
    return header;
  }

  private async cached(
    candidate: DisplayCandidate,
    size: PixelSize,
    header: PictureHeader,
  ): Promise<DisplayFile | null> {
    const key = keyOf(candidate.sha256, size);
    const relative = `${DISPLAY_DIR}/${nameOf(candidate.sha256, size, header.type)}`;
    const place = await realPlaceAsync(this.deps.mediaDir, join(this.deps.mediaDir, relative));
    if (!place?.inside) return null;
    try {
      const info = await stat(place.path);
      if (!info.isFile() || info.size > MAX_COPY_BYTES) return null;
      const actual = await readPictureHeader(place.path);
      if (
        !actual ||
        actual.animated ||
        actual.size.width !== size.width ||
        actual.size.height !== size.height ||
        actual.type !== header.type
      )
        return null;
      const { sha256: hash, bytes } = await sha256File(place.path);
      const file = { key, ...size, path: relative, hash, bytes, ext: header.type };
      this.files.set(`${candidate.sha256}/${key}`, file);
      this.latest.set(candidate.sha256, file);
      return file;
    } catch {
      return null;
    }
  }

  /** A new import is not ready until this resolves successfully. Idle sweeps use the same one-job queue. */
  async prepare(candidate: DisplayCandidate, signal?: AbortSignal, idleOnly = false): Promise<DisplayResult> {
    if (this.cancelled(signal)) return failure('Picture preparation was cancelled.');
    if (!SHA.test(candidate.sha256) || !candidate.path || isAbsolute(candidate.path))
      return failure('The picture is outside the media folder.');
    const place = await realPlaceAsync(this.deps.mediaDir, join(this.deps.mediaDir, candidate.path));
    if (!place?.inside) return failure('The picture is outside the media folder.');
    try {
      const source = await stat(place.path);
      if (!source.isFile() || source.size > MAX_SOURCE_BYTES)
        return failure('The picture is too large to prepare safely.');
      const header = await this.header(candidate);
      if (!header) return failure('The picture header could not be read.');
      if (header.animated) return { ok: true, copy: null };
      const size = displayPictureSize(header.size, this.deps.targets(), candidate.look ?? null);
      if (!size) return { ok: true, copy: null };
      if (header.size.width * header.size.height > MAX_SOURCE_PIXELS)
        return failure('The picture has too many pixels to prepare safely.');
      const key = keyOf(candidate.sha256, size);
      const cached = await this.cached(candidate, size, header);
      if (cached) return { ok: true, copy: cached };
      if (this.cancelled(signal)) return failure('Picture preparation was cancelled.');
      const free = this.deps.freeBytes?.() ?? diskFreeBytes(this.deps.mediaDir);
      if (free < RESERVE_BYTES + Math.min(MAX_COPY_BYTES, size.width * size.height * 4 + 1024 * 1024))
        return failure('Not enough disk space to prepare the picture while keeping 2 GiB free for the show.');
      let job = this.pending.get(key);
      if (!job) {
        let resolve!: (result: DisplayResult) => void;
        const result = new Promise<DisplayResult>((done) => {
          resolve = done;
        });
        job = { candidate, size, header, key, result, resolve, users: 0, idleOnly };
        this.pending.set(key, job);
        if (idleOnly) this.queue.push(job);
        else this.queue.unshift(job);
      } else if (!idleOnly) {
        job.idleOnly = false;
        this.queue = [job, ...this.queue.filter((j) => j !== job)];
      }
      const joined = this.join(job, signal);
      this.start();
      return await joined;
    } catch {
      return failure('The picture could not be prepared.');
    }
  }

  private join(job: Job, signal?: AbortSignal): Promise<DisplayResult> {
    job.users++;
    return new Promise((resolve) => {
      let done = false;
      const finish = (result: DisplayResult) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', abort);
        job.users--;
        resolve(result);
      };
      const abort = () => {
        finish(failure('Picture preparation was cancelled.'));
        if (job.users === 0 && this.pending.get(job.key) === job) {
          const active = this.current?.job === job;
          this.complete(job, failure('Picture preparation was cancelled.'));
          if (active) {
            this.win?.destroy();
            this.win = null;
            this.start();
          }
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      void job.result.then(finish);
      if (signal?.aborted) abort();
    });
  }

  private start(): void {
    if (this.stopped || this.current || this.queue.length === 0) {
      this.settle();
      return;
    }
    if (this.deps.canStart?.() === false || (this.queue[0]?.idleOnly && this.deps.canWork?.() === false)) {
      this.wake ??= setTimeout(() => {
        this.wake = null;
        this.start();
      }, 1000);
      return;
    }
    if (this.win && !this.finishing) return;
    this.win?.destroy();
    this.win = null;
    this.finishing = false;
    try {
      this.win = this.deps.open(() => this.gone());
    } catch {
      for (const job of [...this.pending.values()])
        this.complete(job, failure('The picture worker could not open.'));
    }
  }

  private gone(): void {
    this.win = null;
    if (this.current) this.complete(this.current.job, failure('The picture worker stopped.'));
    if (!this.stopped) this.start();
  }

  private complete(job: Job, result: DisplayResult): void {
    if (this.pending.get(job.key) !== job) return;
    if (this.current?.job === job) {
      clearTimeout(this.current.timer);
      this.current = null;
    }
    this.pending.delete(job.key);
    this.queue = this.queue.filter((j) => j !== job);
    job.resolve(result);
    if (!result.ok) this.deps.log(`Display copy: ${result.message}`);
    this.settle();
  }

  private settle(): void {
    if (this.current || this.pending.size > 0 || this.win) return;
    for (const done of this.idleWaiters.splice(0)) done();
  }

  async next(sender: number): Promise<SharpenJobView | null> {
    if (this.stopped || this.win?.id !== sender || this.current) return null;
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      if (job.idleOnly && this.deps.canWork?.() === false) {
        this.queue.unshift(job);
        this.finishing = true;
        this.start();
        return null;
      }
      const timer = setTimeout(() => {
        const win = this.win;
        this.win = null;
        this.complete(job, failure('Picture preparation took too long.'));
        win?.destroy();
        this.start();
      }, JOB_MS);
      this.current = { job, timer };
      try {
        const source = await realPlaceAsync(this.deps.mediaDir, join(this.deps.mediaDir, job.candidate.path));
        if (!source?.inside) throw new Error('outside media');
        if ((await stat(source.path)).size > MAX_SOURCE_BYTES) throw new Error('too large');
        const data = await readFile(source.path);
        if (data.length > MAX_SOURCE_BYTES) throw new Error('too large');
        if (!this.ownsWorker(sender) || !this.isCurrent(job)) return null;
        return {
          key: job.key,
          data: new Uint8Array(data),
          percent: 0,
          type: job.header.type === 'jpg' ? 'image/jpeg' : 'image/png',
          maxPixels: MAX_SOURCE_PIXELS,
          box: job.size,
          sourceSize: job.header.size,
          resizeOnly: true,
        };
      } catch {
        this.complete(job, failure('The picture could not be read.'));
      }
    }
    this.finishing = true;
    setTimeout(() => {
      if (!this.current && this.queue.length === 0) {
        this.win?.destroy();
        this.win = null;
        this.settle();
      }
    }, 0);
    return null;
  }

  async made(sender: number, key: unknown, bytes: unknown): Promise<boolean> {
    const job = this.current?.job;
    if (!job || this.win?.id !== sender || key !== job.key) return false;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_COPY_BYTES) {
      this.complete(job, failure('The display copy could not be drawn.'));
      return true;
    }
    const header = pictureHeader(bytes);
    if (
      !header ||
      header.animated ||
      header.type !== job.header.type ||
      header.size.width !== job.size.width ||
      header.size.height !== job.size.height
    ) {
      this.complete(job, failure('The display copy has the wrong size or type.'));
      return true;
    }
    const dir = join(this.deps.mediaDir, DISPLAY_DIR);
    const relative = `${DISPLAY_DIR}/${nameOf(job.candidate.sha256, job.size, job.header.type)}`;
    let partial = '';
    try {
      await mkdir(dir, { recursive: true });
      if (!(await realPlaceAsync(this.deps.mediaDir, dir))?.inside) throw new Error('outside media');
      partial = `${join(this.deps.mediaDir, relative)}.part-${randomUUID()}`;
      await writeFile(partial, bytes);
      if (this.stopped || this.pending.get(job.key) !== job) throw new Error('cancelled');
      await rename(partial, join(this.deps.mediaDir, relative));
      const file: DisplayFile = {
        key: job.key,
        ...job.size,
        path: relative,
        hash: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        ext: job.header.type,
      };
      this.files.set(`${job.candidate.sha256}/${job.key}`, file);
      this.latest.set(job.candidate.sha256, file);
      this.complete(job, { ok: true, copy: file });
      this.deps.changed();
    } catch {
      if (partial) await rm(partial, { force: true }).catch(() => undefined);
      this.complete(job, failure('The display copy could not be kept.'));
    }
    return true;
  }

  ready(sha: string, look: PictureLook | null = null): DisplayFile | null {
    const header = this.sources.get(sha);
    if (!header || header.animated) return originalForOlderPictureWithoutDisplayCopy();
    const size = displayPictureSize(header.size, this.deps.targets(), look);
    if (!size) return null;
    const exact = this.files.get(`${sha}/${keyOf(sha, size)}`);
    if (exact) return exact;
    // A larger screen is being prepared: retain a checked older rendition until it is ready.
    return this.latest.get(sha) ?? originalForOlderPictureWithoutDisplayCopy();
  }
  relativePath(sha: string, key: string): string | null {
    return this.files.get(`${sha}/${key}`)?.path ?? null;
  }
  fileOf(sha: string, key: string): DisplayFile | null {
    return this.files.get(`${sha}/${key}`) ?? null;
  }
  refresh(candidates: readonly DisplayCandidate[]): Promise<void> {
    this.sweeping = this.sweeping
      .then(async () => {
        for (const candidate of candidates) {
          if (this.stopped || this.deps.canWork?.() === false) break;
          await this.prepare(candidate, undefined, true);
        }
      })
      .catch(() => undefined);
    return this.sweeping;
  }
  ownsWorker(sender: number): boolean {
    return this.win?.id === sender;
  }
  failWorker(sender: number): void {
    if (this.win?.id !== sender) return;
    const win = this.win;
    this.win = null;
    for (const job of [...this.pending.values()])
      this.complete(job, failure('The picture worker could not run below normal priority.'));
    win.destroy();
    this.settle();
  }
  get working(): boolean {
    return this.current !== null || (this.win !== null && !this.finishing);
  }
  activityChanged(): void {
    this.start();
  }
  async idle(): Promise<void> {
    await this.sweeping;
    if (this.pending.size > 0 || this.win) await new Promise<void>((done) => this.idleWaiters.push(done));
  }
  close(): void {
    this.stopped = true;
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    for (const job of [...this.pending.values()])
      this.complete(job, failure('Picture preparation was cancelled.'));
    this.win?.destroy();
    this.win = null;
    this.settle();
  }
}
