import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { readStateTwice, setAside } from '../state-file';
import { keptTrimSchema, trimCopySchema } from './playlist-trims';

/*
 * Trim's records (FT-4, Session 58): the cuts accepted and waiting to be made or taken in, and the copies made but not
 * yet taken into their rows (playlist-trims.ts). Before, each change was a library setting written on Main, which
 * waited there for an import's write lock. Now they are a small file in the data folder (`trim-cuts.json`), written
 * as recovery/live-state.ts writes the show: in the background, after the writes before it, as a partial file moved
 * over the old one whole. A run of changes is one write; a write that fails is tried again by itself.
 *
 * Written at once, on Main, only where the order matters: before a cut can appear in Media (saveNow: else a crash
 * just after could leave it there with no record), and at quit (quit: the newest is on the disk before Drashti ends,
 * and every change after it is written at once).
 *
 * On upgrade from alpha.17, any cuts it kept in library settings carry on. After a downgrade and re-upgrade, any
 * new records from those settings are merged with the file's records. A restored library is the library before's no more: its records are not carried
 * over, and the restored library's own settings are read, as before alpha.18. Once the file holds what the settings
 * held, they are cleared, so a backup restored later, or alpha.17 after a downgrade, never reads records since
 * finished or stopped (LOW-2). A file that cannot be read is moved aside and empty records written in its place, so
 * the next start reads neither it nor the settings; one that can be neither read nor moved aside is never written
 * over: saves fail (and are tried again) until it moves aside (LOW-3).
 */

export const TRIM_RECORDS_FILE = 'trim-cuts.json';

const fileSchema = z.object({
  version: z.literal(1),
  waiting: z.array(z.unknown()),
  copies: z.array(z.unknown()),
  legacy: z.string().nullable().optional(),
});

/** After a write that fails, the newest is written again this long after, then twice as long after each failure. */
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 5000;
/**
 * A write at once moves its partial file over the old one up to this many times, this far apart: Windows refuses the
 * rename for a moment while another program (a scanner) reads the file, and a cut is not published without it.
 */
const RENAME_TRIES = 3;
const RENAME_PAUSE_MS = 50;

const pause = (ms: number) => {
  // Synchronous on purpose, and only after a refused rename: a cut is about to appear in Media, or Drashti is quitting.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export interface TrimRecordsOptions {
  /**
   * What alpha.17 and before kept in the library's settings. Cleared once the file holds what they held.
   */
  before: { waiting: () => unknown; copies: () => unknown; clear: () => void };
  /** The last start used alpha.17. Used for files written before the legacy settings fingerprint was added. */
  afterDowngrade?: boolean;
  /** A backup restored at this start is in use. Read its own settings even if a record file is present. */
  otherLibrary?: boolean;
  log?: (message: string) => void;
  /** How a background write writes its partial file (tests: a busy or failing disk). The file system's own unless given. */
  writeFile?: (file: string, text: string) => Promise<void>;
  /** How a write moves its partial file over the old one (tests: Windows holding the file for a moment). */
  renameSync?: (from: string, to: string) => void;
  /** The first wait before a failed write is tried again (tests). */
  retryMs?: number;
  /** How a file that cannot be read is moved aside (tests: Windows holding it); state-file.ts's unless given. */
  setAside?: (file: string) => string | null;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? [...(value as unknown[])] : []);

export class TrimRecords {
  private waiting: unknown[] = [];
  private copyRecords: unknown[] = [];
  /** Changes made, and the last of them on the disk. */
  private changes = 0;
  private written = 0;
  private writing: Promise<void> = Promise.resolve();
  /** A background write is waiting its turn: changes until it starts are written by it. */
  private queued = false;
  private retry: NodeJS.Timeout | null = null;
  /** Writes that failed in a row: the first is said, and the one that works after them. */
  private failures = 0;
  /** Drashti is quitting: every change is written at once. */
  private quitting = false;
  /** The change whose write holds what alpha.17's settings held: once it is on the disk, they are cleared. */
  private clearAt: number | null = null;
  /** The legacy settings last consumed. A crash before SQLite clears them cannot bring their cuts back. */
  private legacy: string | null | undefined;
  /** The file could be neither read nor moved aside at the start: never written over until it moves aside. */
  private held = false;

  /** The cuts accepted and waiting (playlist-trims.ts's `kept`). */
  readonly kept = {
    load: (): unknown[] => this.waiting,
    save: (cuts: readonly unknown[]): void => {
      // As they are now: a record changed after (playlist-trims.ts adds a cut's copy to it) is saved again then.
      this.waiting = structuredClone([...cuts]);
      this.changed();
    },
  };

  /** The copies made and not yet taken in (playlist-trims.ts's `copies`). */
  readonly copies = {
    load: (): unknown[] => this.copyRecords,
    save: (copies: readonly unknown[]): void => {
      this.copyRecords = structuredClone([...copies]);
      this.changed();
    },
  };

  constructor(
    private readonly file: string,
    private readonly options: TrimRecordsOptions,
  ) {
    this.removePartials();
    const found = options.otherLibrary
      ? null
      : readStateTwice(file, (raw) => {
          const parsed = fileSchema.safeParse(raw);
          return parsed.success ? parsed.data : null;
        });
    if (found?.status === 'ok') {
      this.waiting = found.value.waiting;
      this.copyRecords = found.value.copies;
      this.legacy = found.value.legacy;
      this.takeLegacy(found.value.legacy !== undefined || options.afterDowngrade === true);
      return;
    }
    if (found && found.status !== 'missing') {
      // Damaged, or held by another program: moved aside with the date (state-file.ts), and nothing waits to carry on.
      const aside = this.setAside();
      options.log?.(
        `Trim’s waiting cuts could not be read (${found.reason}): ${aside ? `kept as ${basename(aside)}` : 'left where it is, and never written over until it can be moved aside'}; nothing waits to carry on`,
      );
      if (aside) {
        // Record the legacy snapshot as already seen without resuming it (LOW-2).
        this.takeLegacy(false);
        if (this.changes === 0) this.changed();
      } else this.held = true;
      return;
    }
    this.takeLegacy(true);
    if (options.otherLibrary) {
      if (this.changes === 0) this.changes = 1;
      this.writeNowSaying();
    }
  }

  private takeLegacy(merge: boolean): void {
    const waiting = list(this.options.before.waiting());
    const copies = list(this.options.before.copies());
    if (waiting.length === 0 && copies.length === 0) return;
    const fingerprint = createHash('sha256').update(JSON.stringify([waiting, copies])).digest('hex');
    if (this.legacy === fingerprint) {
      this.options.before.clear();
      return;
    }
    if (merge) {
      // alpha.17's newer request wins for the same row. Both copies are kept for the normal identity checks.
      const cuts = new Map<string, unknown>();
      for (const value of [...this.waiting, ...waiting]) {
        const cut = keptTrimSchema.safeParse(value);
        if (cut.success) cuts.set(cut.data.itemId, cut.data);
      }
      const files = new Map<string, unknown>();
      for (const value of [...this.copyRecords, ...copies]) {
        const copy = trimCopySchema.safeParse(value);
        if (copy.success) files.set(JSON.stringify([copy.data.path, copy.data.identity]), copy.data);
      }
      this.waiting = [...cuts.values()];
      this.copyRecords = [...files.values()];
    }
    this.legacy = fingerprint;
    this.changed();
    this.clearAt = this.changes;
  }

  private removePartials(): void {
    const folder = dirname(this.file);
    const prefix = `${basename(this.file)}.`;
    try {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          entry.name.startsWith(prefix) &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u.test(
            entry.name.slice(prefix.length),
          )
        ) {
          try {
            rmSync(join(folder, entry.name), { force: true });
          } catch {
            // A scanner may hold the file. The next start can remove it.
          }
        }
      }
    } catch {
      // The folder may be missing or held. Reading the records below has its own recovery.
    }
  }

  /**
   * What the records hold now is on the disk before this returns (a cut is about to appear in Media). Throws when it
   * cannot be written.
   */
  saveNow(): void {
    this.cancelRetry();
    const change = this.changes;
    if (this.written >= change) return;
    const partial = this.partial();
    try {
      this.release();
      writeFileSync(partial, this.text());
      for (let tries = 1; ; tries++) {
        try {
          this.rename(partial, this.file);
          break;
        } catch (error) {
          if (tries >= RENAME_TRIES) throw error;
          pause(RENAME_PAUSE_MS);
        }
      }
    } catch (error) {
      rmSync(partial, { force: true });
      this.failed(error);
      throw error;
    }
    this.wrote(change);
  }

  /**
   * Drashti is quitting on purpose: what is not on the disk yet is written now, and every change from here on at
   * once, so no save is lost (a copy let go as the conversions stop, say). A write under way never lands over them.
   */
  quit(): void {
    this.quitting = true;
    this.writeNowSaying();
  }

  /** Wait for the writes started and queued (tests). */
  async settle(): Promise<void> {
    for (;;) {
      const writing = this.writing;
      await writing;
      if (writing === this.writing) return;
    }
  }

  private changed(): void {
    this.changes += 1;
    if (this.quitting) this.writeNowSaying();
    else this.later();
  }

  /** At once, never throwing (it says why in the log). */
  private writeNowSaying(): void {
    try {
      this.saveNow();
    } catch {
      // Said by failed().
    }
  }

  /** One write in the background, after the writes before it, of the records as they are when it starts. */
  private later(): void {
    this.cancelRetry();
    if (this.queued) return;
    this.queued = true;
    this.writing = this.writing.then(async () => {
      this.queued = false;
      await this.inBackground();
    });
  }

  private async inBackground(): Promise<void> {
    const change = this.changes;
    if (this.written >= change) return;
    const partial = this.partial();
    try {
      this.release();
      await (this.options.writeFile ?? writeFile)(partial, this.text());
      // Moved over the file in the same turn as this check: never older records over newer ones written at once.
      if (this.written >= change) {
        await rm(partial, { force: true });
        return;
      }
      this.rename(partial, this.file);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      this.failed(error);
      return;
    }
    this.wrote(change);
  }

  /**
   * A file that could be neither read nor moved aside at the start (LOW-3: another program held it) is moved aside now,
   * keeping the records it holds; while it cannot be, it is never written over, and the write fails.
   */
  private release(): void {
    if (!this.held) return;
    const aside = this.setAside();
    if (!aside && existsSync(this.file))
      throw new Error(
        'the earlier records could be neither read nor moved aside, so they are not written over',
      );
    this.held = false;
    if (aside)
      this.options.log?.(
        `Trim’s earlier waiting cuts, which could not be read, are kept as ${basename(aside)}`,
      );
  }

  private setAside(): string | null {
    return (this.options.setAside ?? setAside)(this.file);
  }

  private rename(from: string, to: string): void {
    (this.options.renameSync ?? renameSync)(from, to);
  }

  private partial(): string {
    return `${this.file}.${randomUUID()}.tmp`;
  }

  private text(): string {
    return JSON.stringify({
      version: 1,
      waiting: this.waiting,
      copies: this.copyRecords,
      legacy: this.legacy ?? null,
    });
  }

  private wrote(change: number): void {
    this.written = Math.max(this.written, change);
    if (this.clearAt !== null && this.written >= this.clearAt) {
      // The file holds what alpha.17's settings held: they go, so nothing reads them again (LOW-2).
      this.clearAt = null;
      this.options.before.clear();
    }
    if (this.failures > 0) {
      const failed = this.failures === 1 ? '1 failed save' : `${String(this.failures)} failed saves`;
      this.options.log?.(`Saved Trim’s waiting cuts again, after ${failed}`);
    }
    this.failures = 0;
  }

  /**
   * Said once for failures in a row, and tried again by itself (the next change may never come): RETRY_FIRST_MS on,
   * twice as long after each failure in a row, up to RETRY_MAX_MS. Never after the quit's writes.
   */
  private failed(error: unknown): void {
    this.failures += 1;
    if (this.failures === 1)
      this.options.log?.(`Could not save Trim’s waiting cuts: ${(error as Error).message}`);
    if (this.quitting || this.retry) return;
    const first = this.options.retryMs ?? RETRY_FIRST_MS;
    this.retry = setTimeout(
      () => {
        this.retry = null;
        if (this.written < this.changes) this.later();
      },
      Math.min(first * 2 ** (this.failures - 1), RETRY_MAX_MS),
    );
    // It never keeps a process up by itself (Node's, in tests); Drashti's own runs on, so it comes.
    this.retry.unref();
  }

  private cancelRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
}
