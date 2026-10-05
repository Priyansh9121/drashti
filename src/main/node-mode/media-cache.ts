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
 * A screen asking for a file that is not here yet waits for it for as long
 * as the file is on the screens and its copy can still arrive (its previous
 * picture stays up meanwhile); a copy that lands after a screen stopped
 * waiting is announced, so the screen loads it then.
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
  /** A copy has just landed (screens that gave up on it load it now). */
  landed?(mediaId: string): void;
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
/** A file that could not be copied is tried again after this; one a screen is waiting for, sooner. */
const RETRY_MS = 15_000;
const URGENT_RETRY_MS = 2000;
/** How often a screen's wait is checked: is the file still on the screens, and Main reachable? */
const HOLD_CHECK_MS = 1000;
/** A copy that fails its hash this many times is given up (Main's own file is not what it says). */
const HASH_TRIES = 3;

class NoRoom extends Error {}
/** Main has no such file (or it never matches its hash): no point trying again. */
class Gone extends Error {}

export class MediaCache {
  private index: IndexFile = { files: new Map(), ids: new Map() };
  private wanted: MediaWant[] = [];
  private readonly urgent = new Set<string>();
  private readonly waiters = new Map<string, ((path: string | null) => void)[]>();
  private readonly failedAt = new Map<string, number>();
  private readonly hashFailures = new Map<string, number>();
  private holdTimer: NodeJS.Timeout | null = null;
  /** The copy under way (to stop it), the loop copying, and whether the cache has been closed. */
  private current: IncomingMessage | null = null;
  private runner: Promise<void> | null = null;
  private closed = false;
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
      this.writeIndex();
    }, 500);
  }

  private writeIndex(): void {
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
   * A screen asks for this item and it is not here: its copy at once, ahead
   * of everything else. Resolves with its path once it lands; with null once
   * it cannot: Main has no such file, there is no room, the item is no longer
   * on the screens (nor up next), or Main cannot be reached. A copy that
   * breaks off is tried again meanwhile.
   */
  ensure(mediaId: string): Promise<string | null> {
    const path = this.pathFor(mediaId);
    if (path) return Promise.resolve(path);
    if (!MEDIA_ID_PATTERN.test(mediaId)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const list = this.waiters.get(mediaId) ?? [];
      if (list.length === 0) this.deps.log('info', `Media copies: a screen waits for ${mediaId}`);
      list.push(resolve);
      this.waiters.set(mediaId, list);
      this.urgent.add(mediaId);
      this.failedAt.delete(mediaId);
      this.watchHolds();
      this.kick();
    });
  }

  /** Let go of screens' waits that can no longer end with the file. */
  private watchHolds(): void {
    this.holdTimer ??= setInterval(() => {
      const online = this.deps.online();
      const shown = new Set(this.deps.inUse());
      for (const id of [...this.waiters.keys()])
        if (!online || !shown.has(id))
          this.settle(id, null, online ? 'no longer on the screens' : 'Main is away');
      if (this.waiters.size === 0 && this.holdTimer) {
        clearInterval(this.holdTimer);
        this.holdTimer = null;
      }
    }, HOLD_CHECK_MS);
  }

  /** Try again now (Main came back, or the screens changed). */
  kick(): void {
    if (this.closed || this.running) return;
    this.runner = this.run();
  }

  /** Stop: the copy under way breaks off (it carries on next time), and nobody waits any more. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.current?.destroy();
    for (const id of [...this.waiters.keys()]) this.settle(id, null, 'closing');
    await this.runner?.catch(() => undefined);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeIndex();
    }
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

  private settle(mediaId: string, path: string | null, why?: string): void {
    const list = this.waiters.get(mediaId);
    if (list && path === null)
      this.deps.log('info', `Media copies: a screen stopped waiting for ${mediaId} (${why})`);
    this.waiters.delete(mediaId);
    this.urgent.delete(mediaId);
    for (const resolve of list ?? []) resolve(path);
  }

  /** A copy is here: whoever waits gets it, and screens that gave up hear of it. */
  private arrived(mediaId: string): void {
    this.settle(mediaId, this.pathFor(mediaId));
    this.deps.landed?.(mediaId);
  }

  private next(): string | null {
    const t = this.now();
    const ready = (id: string) =>
      (this.failedAt.get(id) ?? 0) + (this.urgent.has(id) ? URGENT_RETRY_MS : RETRY_MS) <= t;
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
      for (let id = this.next(); id !== null && this.deps.online() && !this.closed; id = this.next()) {
        try {
          await this.copy(id);
          this.problem = null;
        } catch (error) {
          this.failedAt.set(id, this.now());
          if (error instanceof NoRoom) {
            this.problem = error.message;
            this.settle(id, null, 'no room');
            break;
          }
          this.deps.log('warn', `Media copies: ${id} not copied (${(error as Error).message})`);
          // Gone for good: a screen waiting for it stops; anything else is tried again.
          if (error instanceof Gone) this.settle(id, null, error.message);
        } finally {
          this.copying = null;
          this.deps.changed();
        }
      }
    } finally {
      this.running = false;
    }
    // Something failed: come back to it later (soon, when a screen waits for it).
    if (this.failedAt.size > 0 && !this.closed) {
      const after = this.urgent.size > 0 ? URGENT_RETRY_MS : RETRY_MS;
      const t = this.now();
      const missing = this.deps.inUse().filter((id) => !this.has(id) && this.index.ids.has(id));
      if (missing.length > 0 && this.deps.online()) {
        const due = missing.map(
          (id) =>
            `${id} ${(this.failedAt.get(id) ?? 0) + (this.urgent.has(id) ? URGENT_RETRY_MS : RETRY_MS) - t} ms`,
        );
        this.deps.log(
          'info',
          `Media copies: ${missing.length} on the screens not here yet; looking again in ${after} ms (due: ${due.join(', ')})`,
        );
      }
      setTimeout(() => this.kick(), after).unref();
    }
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
      if (res.statusCode === 404) throw new Gone('Main has no such file');
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
      this.arrived(mediaId);
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
    this.deps.log(
      'info',
      `Media copies: copying ${mediaId} (${formatBytes(total)}${from > 0 ? `, from ${formatBytes(from)} on` : ''})`,
    );
    this.deps.changed();
    res.on('data', (chunk: Buffer) => {
      if (this.copying) this.copying.done += chunk.length;
    });
    this.current = res;
    try {
      await pipeline(res, createWriteStream(part, { flags: from > 0 ? 'a' : 'w' }));
    } finally {
      this.current = null;
    }
    const checked = await sha256File(part);
    if (checked.sha256 !== sha256) {
      rmSync(part, { force: true });
      const tries = (this.hashFailures.get(mediaId) ?? 0) + 1;
      this.hashFailures.set(mediaId, tries);
      if (tries >= HASH_TRIES) throw new Gone(`the copy never matched its hash (${tries} tries)`);
      throw new Error('the copy did not match its hash; it will be copied again');
    }
    this.hashFailures.delete(mediaId);
    renameSync(part, this.pathOf(sha256, ext));
    this.index.files.set(sha256, { ext, bytes: checked.bytes, wantedAt: this.now() });
    this.save();
    this.deps.log('info', `Media copies: ${mediaId} copied`);
    this.arrived(mediaId);
  }
}
