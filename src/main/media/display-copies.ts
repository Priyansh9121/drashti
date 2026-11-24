import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PictureLook, PixelSize } from '../../shared/picture-look';
import { displayPictureSize, originalForOlderPictureWithoutDisplayCopy } from '../../shared/picture-display';
import {
  MAX_DISPLAY_COPY_BYTES,
  MAX_DISPLAY_SOURCE_BYTES,
  type DisplayCopyBlob,
  type SharpenJobView,
} from '../../shared/pictures';
import { mediaUrl } from '../../shared/media';
import type { MediaFileRow } from './media-protocol';
import { diskFreeBytes, sha256File } from '../import/media-store';
import { realPlaceAsync } from './contained';
import { readPictureHeader, type PictureHeader } from './picture-header';
import { hashDisplayFile } from './display-file-hash';

export const DISPLAY_DIR = 'display';
const MAX_SOURCE_BYTES = MAX_DISPLAY_SOURCE_BYTES;
const MAX_COPY_BYTES = MAX_DISPLAY_COPY_BYTES;
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
export interface DisplayWorker {
  id: number;
  destroy(): void;
  /** Recheck this window's current OS process immediately before each job grant. */
  beforeBytes(): void;
  /** The private Session writes this worker's encoded Blob without a full Main byte array. */
  saveBlob(blob: DisplayCopyBlob, destination: string, signal: AbortSignal): Promise<void>;
}
export interface DisplayDeps {
  mediaDir: string;
  targets(): readonly PixelSize[];
  open(gone: () => void): DisplayWorker;
  changed(): void;
  log(message: string): void;
  canWork?(): boolean;
  /** Shared picture worker arbitration, for imports and sweeps alike. */
  canStart?(): boolean;
  /**
   * Told each time the queue looks: true while it is held (canStart, or an idle-only job while something is up), false
   * once a copy starts or nothing waits. The import's status line says why a new picture waits (QA22-L8-1).
   */
  held?(waiting: boolean): void;
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
  transfer: AbortController;
}
const failure = (message: string): DisplayResult => ({ ok: false, message });
const keyOf = (sha: string, size: PixelSize) =>
  `p1-${/^[a-f0-9]{32}/u.exec(sha)?.[0] ?? ''}-${String(size.width)}x${String(size.height)}`;
const nameOf = (sha: string, size: PixelSize, ext: string) =>
  `v1-${sha}-${String(size.width)}x${String(size.height)}.${ext}`;

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
  private win: DisplayWorker | null = null;
  private generation = 0;
  private active = false;
  private waiting: { sender: number; resolve(job: SharpenJobView | null): void } | null = null;
  private current: {
    job: Job;
    timer: ReturnType<typeof setTimeout>;
    granted: boolean;
    receiving: boolean;
  } | null = null;
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
    let valid = false;
    try {
      const place = await realPlaceAsync(this.deps.mediaDir, join(this.deps.mediaDir, relative));
      if (!place?.inside) return null;
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
      const previous = this.files.get(`${candidate.sha256}/${key}`);
      this.files.set(`${candidate.sha256}/${key}`, file);
      const largest = this.latest.get(candidate.sha256);
      if (!largest || file.width * file.height >= largest.width * largest.height)
        this.latest.set(candidate.sha256, file);
      valid = true;
      if (previous?.hash !== file.hash) this.deps.changed();
      return file;
    } catch {
      return null;
    } finally {
      if (!valid && this.files.delete(`${candidate.sha256}/${key}`)) {
        if (this.latest.get(candidate.sha256)?.key === key) {
          this.latest.delete(candidate.sha256);
          for (const [id, file] of this.files) {
            if (!id.startsWith(`${candidate.sha256}/`)) continue;
            const largest = this.latest.get(candidate.sha256);
            if (!largest || file.width * file.height > largest.width * largest.height)
              this.latest.set(candidate.sha256, file);
          }
        }
        this.deps.changed();
      }
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
        job = {
          candidate,
          size,
          header,
          key,
          result,
          resolve,
          users: 0,
          idleOnly,
          transfer: new AbortController(),
        };
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
            this.destroyWorker();
            this.start();
          }
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      void job.result.then(finish);
      if (signal?.aborted) abort();
    });
  }

  private resolveWaiting(): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.resolve(null);
  }

  private destroyWorker(): void {
    const win = this.win;
    this.win = null;
    this.generation++;
    this.active = false;
    this.resolveWaiting();
    win?.destroy();
  }

  private openWorker(): void {
    if (this.win || this.stopped) return;
    const generation = ++this.generation;
    try {
      this.win = this.deps.open(() => {
        if (this.generation === generation) this.gone();
      });
    } catch {
      this.active = false;
      for (const job of [...this.pending.values()])
        this.complete(job, failure('The picture worker could not open.'));
      this.resolveWaiting();
      this.settle();
    }
  }

  /** Build the empty worker while nothing is up, before a first import has to do it during the show. */
  private warm(): void {
    if (!this.stopped && this.deps.canWork?.() !== false) this.openWorker();
  }

  private start(): void {
    if (this.stopped || this.current) return;
    if (this.queue.length === 0) {
      this.active = false;
      this.deps.held?.(false);
      this.settle();
      return;
    }
    if (this.deps.canStart?.() === false || (this.queue[0]?.idleOnly && this.deps.canWork?.() === false)) {
      this.deps.held?.(true);
      this.active = false;
      this.wake ??= setTimeout(() => {
        this.wake = null;
        this.start();
      }, 1000);
      return;
    }
    // Claim the shared decode slot before opening or waking the worker. An empty warm worker owns none.
    this.deps.held?.(false);
    this.active = true;
    this.openWorker();
    const waiting = this.waiting;
    if (!this.win || !waiting) return;
    this.waiting = null;
    void this.grant(waiting.sender).then((job) => waiting.resolve(job));
  }

  private gone(): void {
    this.win = null;
    this.generation++;
    this.active = false;
    this.resolveWaiting();
    if (this.current) this.complete(this.current.job, failure('The picture worker stopped.'));
    if (!this.stopped) this.start();
    this.settle();
  }

  private complete(job: Job, result: DisplayResult): void {
    if (this.pending.get(job.key) !== job) return;
    if (this.current?.job === job) {
      clearTimeout(this.current.timer);
      this.current = null;
      this.active = false;
    }
    this.pending.delete(job.key);
    this.queue = this.queue.filter((j) => j !== job);
    job.transfer.abort();
    if (!this.current && this.queue.length === 0) this.active = false;
    job.resolve(result);
    if (!result.ok) this.deps.log(`Display copy: ${result.message}`);
    this.settle();
  }

  private settle(): void {
    if (this.current || this.pending.size > 0) return;
    for (const done of this.idleWaiters.splice(0)) done();
  }

  next(sender: number): Promise<SharpenJobView | null> {
    if (this.stopped || this.win?.id !== sender || this.current || this.waiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = { sender, resolve };
      this.start();
    });
  }

  private async grant(sender: number): Promise<SharpenJobView | null> {
    const job = this.queue.shift();
    if (!job || !this.ownsWorker(sender) || this.stopped) return null;
    const timer = setTimeout(() => {
      if (!this.isCurrent(job)) return;
      this.complete(job, failure('Picture preparation took too long.'));
      this.destroyWorker();
      this.start();
    }, JOB_MS);
    this.current = { job, timer, granted: false, receiving: false };
    try {
      const source = await realPlaceAsync(this.deps.mediaDir, join(this.deps.mediaDir, job.candidate.path));
      if (!source?.inside) throw new Error('outside media');
      const info = await stat(source.path);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_SOURCE_BYTES) throw new Error('too large');
      if (!this.ownsWorker(sender) || !this.isCurrent(job)) return null;
      try {
        this.win?.beforeBytes();
      } catch {
        this.failWorker(sender);
        return null;
      }
      if (!this.ownsWorker(sender) || !this.isCurrent(job)) return null;
      this.current.granted = true;
      return {
        key: job.key,
        source: mediaUrl(job.key),
        maxBytes: MAX_SOURCE_BYTES,
        percent: 0,
        type: job.header.type === 'jpg' ? 'image/jpeg' : 'image/png',
        maxPixels: MAX_SOURCE_PIXELS,
        box: job.size,
        sourceSize: job.header.size,
        resizeOnly: true,
      };
    } catch {
      this.complete(job, failure('The picture could not be read.'));
      // The failed import resolves, but the same empty renderer can wait for the following owned job.
      return this.next(sender);
    }
  }

  /** This Session serves only the exact job granted to its worker, and only until that job ends. */
  workerSource(sender: number, key: string): MediaFileRow | null {
    const current = this.current;
    if (!current?.granted || !this.ownsWorker(sender) || key !== current.job.key) return null;
    return { path: current.job.candidate.path, sha256: current.job.candidate.sha256, missing: false };
  }

  async made(sender: number, key: unknown, source: unknown): Promise<boolean> {
    const current = this.current;
    const job = current?.job;
    const worker = this.win;
    if (
      !current ||
      !job ||
      !worker ||
      !current.granted ||
      current.receiving ||
      worker.id !== sender ||
      key !== job.key
    )
      return false;
    if (
      !source ||
      typeof source !== 'object' ||
      !('url' in source) ||
      typeof source.url !== 'string' ||
      source.url.length > 512 ||
      !('bytes' in source) ||
      typeof source.bytes !== 'number' ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes <= 0 ||
      source.bytes > MAX_COPY_BYTES
    ) {
      this.complete(job, failure('The display copy could not be drawn.'));
      return true;
    }
    current.receiving = true;
    const blob: DisplayCopyBlob = { url: source.url, bytes: source.bytes };
    const dir = join(this.deps.mediaDir, DISPLAY_DIR);
    const relative = `${DISPLAY_DIR}/${nameOf(job.candidate.sha256, job.size, job.header.type)}`;
    let partial = '';
    try {
      const free = this.deps.freeBytes?.() ?? diskFreeBytes(this.deps.mediaDir);
      if (free < RESERVE_BYTES + blob.bytes) {
        this.complete(
          job,
          failure('Not enough disk space to keep the display copy and 2 GiB free for the show.'),
        );
        return true;
      }
      await mkdir(dir, { recursive: true });
      if (!(await realPlaceAsync(this.deps.mediaDir, dir))?.inside) throw new Error('outside media');
      partial = `${join(this.deps.mediaDir, relative)}.part-${randomUUID()}`;
      await worker.saveBlob(blob, partial, job.transfer.signal);
      if (this.cancelled() || this.pending.get(job.key) !== job) throw new Error('cancelled');
      const actual = await stat(partial);
      const header = await readPictureHeader(partial);
      if (
        !actual.isFile() ||
        actual.size !== blob.bytes ||
        actual.size > MAX_COPY_BYTES ||
        !header ||
        header.animated ||
        header.type !== job.header.type ||
        header.size.width !== job.size.width ||
        header.size.height !== job.size.height
      ) {
        await rm(partial, { force: true });
        this.complete(job, failure('The display copy has the wrong size or type.'));
        return true;
      }
      // One reused small buffer avoids both the full-result IPC clone and WebCrypto's full-input copy.
      const hash = await hashDisplayFile(partial, blob.bytes, job.transfer.signal);
      if (this.cancelled() || this.pending.get(job.key) !== job) throw new Error('cancelled');
      await rename(partial, join(this.deps.mediaDir, relative));
      const file: DisplayFile = {
        key: job.key,
        ...job.size,
        path: relative,
        hash,
        bytes: blob.bytes,
        ext: job.header.type,
      };
      this.files.set(`${job.candidate.sha256}/${job.key}`, file);
      const largest = this.latest.get(job.candidate.sha256);
      if (!largest || file.width * file.height >= largest.width * largest.height)
        this.latest.set(job.candidate.sha256, file);
      this.complete(job, { ok: true, copy: file });
      this.deps.changed();
    } catch {
      if (partial) await rm(partial, { force: true }).catch(() => undefined);
      this.complete(job, failure('The display copy could not be kept.'));
    }
    return true;
  }

  ready(sha: string, look: PictureLook | null = null, targets?: readonly PixelSize[]): DisplayFile | null {
    const header = this.sources.get(sha);
    if (!header || header.animated)
      return originalForOlderPictureWithoutDisplayCopy<DisplayFile>(null, { original: true, display: false });
    const size = displayPictureSize(header.size, targets ?? this.deps.targets(), look);
    if (!size) return null;
    const exact = this.files.get(`${sha}/${keyOf(sha, size)}`);
    if (exact) return exact;
    // A larger screen is being prepared: retain a checked older rendition until it is ready.
    return (
      this.latest.get(sha) ??
      originalForOlderPictureWithoutDisplayCopy<DisplayFile>(null, { original: true, display: false })
    );
  }
  relativePath(sha: string, key: string): string | null {
    return this.files.get(`${sha}/${key}`)?.path ?? null;
  }
  fileOf(sha: string, key: string): DisplayFile | null {
    return this.files.get(`${sha}/${key}`) ?? null;
  }
  refresh(candidates: readonly DisplayCandidate[]): Promise<void> {
    this.warm();
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
    this.destroyWorker();
    for (const job of [...this.pending.values()])
      this.complete(job, failure('The picture worker could not run below normal priority.'));
    this.settle();
  }
  get working(): boolean {
    return this.active || this.current !== null;
  }
  activityChanged(): void {
    this.start();
  }
  async idle(): Promise<void> {
    await this.sweeping;
    if (this.pending.size > 0 || this.current) await new Promise<void>((done) => this.idleWaiters.push(done));
  }
  close(): void {
    this.stopped = true;
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    for (const job of [...this.pending.values()])
      this.complete(job, failure('Picture preparation was cancelled.'));
    this.destroyWorker();
    this.settle();
  }
}

/** Regenerable files go with their original; only exact, regular cache files inside Media are removed. */
export async function removeDisplayCopiesOf(mediaDir: string, sha256: string): Promise<void> {
  if (!SHA.test(sha256)) return;
  const dir = await realPlaceAsync(mediaDir, join(mediaDir, DISPLAY_DIR));
  if (!dir?.inside) return;
  const pattern = new RegExp(`^v1-${sha256}-[1-9][0-9]*x[1-9][0-9]*\\.(?:jpg|png)$`, 'u');
  for (const entry of await readdir(dir.path, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && pattern.test(entry.name))
      await rm(join(dir.path, entry.name), { force: true }).catch(() => undefined);
  }
}
