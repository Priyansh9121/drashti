import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { formatBytes } from '../../shared/format';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import { MEDIA_EXT_PATTERN, type MediaWant, type NodeMediaStatus } from '../../shared/nodes';
import { diskFreeBytes, sha256File } from '../import/media-store';

/*
 * A node's copies of Main's media (Session 13): files by their content hash
 * (sha256.ext, so each is served as what it is), with an index of which
 * media id is which file. Main says what to have and in what order; anything
 * on the screens (or up next) that is not here yet is fetched at once, ahead
 * of the list. One file at a time; an interrupted copy carries on from where
 * it stopped; every copy is checked against its hash before it is used.
 * 2 GB stays free on the disk: copies nothing wants go first, and copies
 * nothing has wanted for 30 days go anyway.
 */

export interface CacheDeps {
  dir: string;
  /** A file from Main from this byte on (rejects when Main cannot be reached). */
  open(mediaId: string, fromByte: number): Promise<IncomingMessage>;
  /** Main can be reached now. */
  online(): boolean;
  /** Media on the screens or up next now: never removed, fetched first. */
  inUse(): string[];
  changed(): void;
  log(level: 'info' | 'warn', message: string): void;
  freeBytes?: (dir: string) => number;
  reserveBytes?: number;
  now?: () => number;
}

interface FileEntry {
  ext: string;
  bytes: number;
  /** When Main last wanted it (ms since the epoch). */
  wantedAt: number;
}

interface IndexFile {
  files: Map<string, FileEntry>;
  ids: Map<string, { sha256: string; ext: string; bytes: number }>;
}

const GiB = 1024 * 1024 * 1024;
const KEEP_DAYS_MS = 30 * 24 * 3600 * 1000;
/** A file that could not be copied is tried again after this. */
const RETRY_MS = 15_000;

class NoRoom extends Error {}

export class MediaCache {
  private index: IndexFile = { files: new Map(), ids: new Map() };
  private wanted: MediaWant[] = [];
  private readonly urgent = new Set<string>();
  private readonly waiters = new Map<string, ((path: string | null) => void)[]>();
  private readonly failedAt = new Map<string, number>();
  private copying: { id: string; bytes: number; done: number } | null = null;
  private problem: string | null = null;
  private running = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly freeBytes: (dir: string) => number;
  private readonly reserve: number;
  private readonly now: () => number;

  constructor(private readonly deps: CacheDeps) {
    this.freeBytes = deps.freeBytes ?? diskFreeBytes;
    this.reserve = deps.reserveBytes ?? 2 * GiB;
    this.now = deps.now ?? Date.now;
    mkdirSync(join(deps.dir, '.part'), { recursive: true });
    this.load();
  }

  private get indexFile(): string {
    return join(this.deps.dir, 'index.json');
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8')) as {
        files?: Record<string, FileEntry>;
        ids?: Record<string, { sha256: string; ext: string; bytes: number }>;
      };
      this.index = {
        files: new Map(Object.entries(raw.files ?? {})),
        ids: new Map(Object.entries(raw.ids ?? {})),
      };
    } catch {
      this.index = { files: new Map(), ids: new Map() };
    }
    // A file that is gone, or not the size it was, is not a copy.
    for (const [sha, f] of this.index.files) {
      const size = statSync(this.pathOf(sha, f.ext), { throwIfNoEntry: false })?.size;
      if (size !== f.bytes || !/^[0-9a-f]{64}$/u.test(sha) || !MEDIA_EXT_PATTERN.test(f.ext))
        this.index.files.delete(sha);
    }
  }

  private save(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null;
      try {
        const temp = `${this.indexFile}.writing`;
        writeFileSync(
          temp,
          JSON.stringify({
            files: Object.fromEntries(this.index.files),
            ids: Object.fromEntries(this.index.ids),
          }),
        );
        renameSync(temp, this.indexFile);
      } catch (error) {
        this.deps.log('warn', `Media copies: could not keep the index (${(error as Error).message})`);
      }
    }, 500);
  }

  private pathOf(sha256: string, ext: string): string {
    return join(this.deps.dir, ext ? `${sha256}.${ext}` : sha256);
  }

  /** Where this media item's copy is, or null while there is none. */
  pathFor(mediaId: string): string | null {
    const known = this.index.ids.get(mediaId);
    if (!known) return null;
    const file = this.index.files.get(known.sha256);
    return file ? this.pathOf(known.sha256, file.ext) : null;
  }

  has(mediaId: string): boolean {
    return this.pathFor(mediaId) !== null;
  }

  /** Main's list, in order. Copies for it start; the rest are kept for a while. */
  setWanted(list: MediaWant[]): void {
    this.wanted = list;
    const at = this.now();
    for (const w of list) {
      this.index.ids.set(w.id, { sha256: w.sha256, ext: w.ext, bytes: w.bytes });
      const file = this.index.files.get(w.sha256);
      if (file) file.wantedAt = at;
    }
    this.save();
    this.cleanUp(0);
    this.kick();
    this.deps.changed();
  }

  /**
   * This item is on the screens (or up next) now: its copy at once, ahead of
   * everything else. Resolves with its path, or null when it cannot be had.
   */
  ensure(mediaId: string): Promise<string | null> {
    const path = this.pathFor(mediaId);
    if (path) return Promise.resolve(path);
    if (!MEDIA_ID_PATTERN.test(mediaId)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const list = this.waiters.get(mediaId) ?? [];
      list.push(resolve);
      this.waiters.set(mediaId, list);
      this.urgent.add(mediaId);
      this.failedAt.delete(mediaId);
      this.kick();
    });
  }

  /** Try again now (Main came back, or the screens changed). */
  kick(): void {
    void this.run();
  }

  status(missingNow: number): NodeMediaStatus {
    let ready = 0;
    let bytesWanted = 0;
    let bytesReady = 0;
    for (const w of this.wanted) {
      bytesWanted += w.bytes;
      if (this.index.files.has(w.sha256)) {
        ready++;
        bytesReady += w.bytes;
      }
    }
    return {
      wanted: this.wanted.length,
      ready,
      bytesWanted,
      bytesReady,
      copying: this.copying ? { ...this.copying } : null,
      missingNow,
      problem: this.problem,
    };
  }

  private settle(mediaId: string, path: string | null): void {
    const list = this.waiters.get(mediaId);
    this.waiters.delete(mediaId);
    this.urgent.delete(mediaId);
    for (const resolve of list ?? []) resolve(path);
  }

  private next(): string | null {
    const t = this.now();
    const ready = (id: string) => (this.failedAt.get(id) ?? 0) + RETRY_MS <= t;
    for (const id of this.urgent) {
      if (this.has(id)) this.settle(id, this.pathFor(id));
      else if (ready(id)) return id;
    }
    for (const id of this.deps.inUse()) if (!this.has(id) && ready(id) && this.index.ids.has(id)) return id;
    for (const w of this.wanted) if (!this.index.files.has(w.sha256) && ready(w.id)) return w.id;
    return null;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let id = this.next(); id !== null && this.deps.online(); id = this.next()) {
        try {
          await this.copy(id);
          this.problem = null;
        } catch (error) {
          this.failedAt.set(id, this.now());
          if (error instanceof NoRoom) {
            this.problem = error.message;
            this.settle(id, null);
            break;
          }
          this.deps.log('warn', `Media copies: ${id} not copied (${(error as Error).message})`);
          if (this.urgent.has(id)) this.settle(id, null);
        } finally {
          this.copying = null;
          this.deps.changed();
        }
      }
    } finally {
      this.running = false;
    }
    // Something failed: come back to it later.
    if (this.failedAt.size > 0) setTimeout(() => this.kick(), RETRY_MS).unref();
  }

  private room(bytes: number): boolean {
    return this.freeBytes(this.deps.dir) - bytes >= this.reserve;
  }

  /** Remove copies nothing has wanted for 30 days, and (to make room) those not wanted now, oldest first. */
  private cleanUp(needBytes: number): void {
    const keep = new Set(this.wanted.map((w) => w.sha256));
    for (const id of this.deps.inUse()) {
      const sha = this.index.ids.get(id)?.sha256;
      if (sha) keep.add(sha);
    }
    const t = this.now();
    const spare = [...this.index.files]
      .filter(([sha]) => !keep.has(sha))
      .sort((a, b) => a[1].wantedAt - b[1].wantedAt);
    for (const [sha, f] of spare) {
      const old = t - f.wantedAt > KEEP_DAYS_MS;
      if (!old && (needBytes <= 0 || this.room(needBytes))) continue;
      rmSync(this.pathOf(sha, f.ext), { force: true });
      this.index.files.delete(sha);
      this.deps.log('info', `Media copies: removed a copy nothing wants (${formatBytes(f.bytes)})`);
    }
    this.save();
  }

  private async copy(mediaId: string): Promise<void> {
    const part = join(this.deps.dir, '.part', mediaId);
    const known = this.index.ids.get(mediaId);
    if (known && !this.room(known.bytes)) {
      this.cleanUp(known.bytes);
      if (!this.room(known.bytes))
        throw new NoRoom(
          `Not enough room on this node’s disk to copy ${formatBytes(known.bytes)} and keep 2 GB free.`,
        );
    }
    let from = existsSync(part) ? statSync(part).size : 0;
    let res = await this.deps.open(mediaId, from);
    if (res.statusCode === 416 || (from > 0 && res.statusCode === 200)) {
      // The partial copy does not fit what Main has now: start again.
      res.resume();
      rmSync(part, { force: true });
      from = 0;
      if (res.statusCode === 416) res = await this.deps.open(mediaId, 0);
    }
    if (res.statusCode !== 200 && res.statusCode !== 206) {
      res.resume();
      throw new Error(`Main answered ${res.statusCode ?? 'nothing'}`);
    }
    const sha256 = String(res.headers['x-drashti-sha256'] ?? '');
    const ext = String(res.headers['x-drashti-ext'] ?? '');
    if (!/^[0-9a-f]{64}$/u.test(sha256) || !MEDIA_EXT_PATTERN.test(ext)) {
      res.resume();
      throw new Error('Main’s answer did not say what the file is');
    }
    const rest = Number(res.headers['content-length'] ?? 0);
    const total = from + rest;
    this.index.ids.set(mediaId, { sha256, ext, bytes: total });
    if (this.index.files.has(sha256)) {
      // Another item with the same file is here already.
      res.resume();
      rmSync(part, { force: true });
      this.settle(mediaId, this.pathFor(mediaId));
      return;
    }
    if (!this.room(rest)) {
      res.resume();
      this.cleanUp(rest);
      if (!this.room(rest))
        throw new NoRoom(
          `Not enough room on this node’s disk to copy ${formatBytes(total)} and keep 2 GB free.`,
        );
      res = await this.deps.open(mediaId, from);
    }
    this.copying = { id: mediaId, bytes: total, done: from };
    this.deps.changed();
    res.on('data', (chunk: Buffer) => {
      if (this.copying) this.copying.done += chunk.length;
    });
    await pipeline(res, createWriteStream(part, { flags: from > 0 ? 'a' : 'w' }));
    const checked = await sha256File(part);
    if (checked.sha256 !== sha256) {
      rmSync(part, { force: true });
      throw new Error('the copy did not match its hash; it will be copied again');
    }
    renameSync(part, this.pathOf(sha256, ext));
    this.index.files.set(sha256, { ext, bytes: checked.bytes, wantedAt: this.now() });
    this.save();
    this.settle(mediaId, this.pathFor(mediaId));
  }
}
