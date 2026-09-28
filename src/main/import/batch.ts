import type { Db } from '../db/database';

/*
 * Writing imported items in small groups. On the Windows CI runner nearly all
 * of an import's time went to commits (129 s of 135 s for 400 presentations,
 * about 320 ms per commit), so items are written into one open transaction
 * and committed together once the group has been open for about `budgetMs`.
 *
 * Each item is written inside its own savepoint: one that fails is rolled
 * back alone and the rest of the group stays. If the commit itself fails,
 * every item of the group is written again on its own, so one bad file can
 * never lose the others. An item's `committed` callback runs only after its
 * rows are committed (so the main process never hears of rows it cannot see).
 */

interface Pending {
  write: () => unknown;
  result: unknown;
  committed?: (result: unknown) => void;
  failed?: (error: unknown) => void;
}

export interface BatchCallbacks<T> {
  committed?: (result: T) => void;
  /** The item's rows were rolled back (its own error, or its retry after a failed commit). */
  failed?: (error: unknown) => void;
}

export class BatchWriter {
  private pending: Pending[] = [];
  private openedAt: number | null = null;
  private savepoints = 0;
  private readonly budgetMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    options: { budgetMs?: number; now?: () => number } = {},
  ) {
    this.budgetMs = options.budgetMs ?? 250;
    this.now = options.now ?? (() => performance.now());
  }

  /** True while a group is open (its rows are visible to this connection only). */
  get isOpen(): boolean {
    return this.openedAt !== null;
  }

  /**
   * Run an item's writes in the open group (opening one if needed). Returns
   * what `write` returned, or undefined when it failed (then it was rolled
   * back and `failed` was called).
   */
  write<T>(write: () => T, callbacks: BatchCallbacks<T> = {}): T | undefined {
    if (this.openedAt === null) {
      this.db.exec('BEGIN');
      this.openedAt = this.now();
    }
    const name = `item${++this.savepoints}`;
    this.db.exec(`SAVEPOINT ${name}`);
    let result: T;
    try {
      result = write();
      this.db.exec(`RELEASE ${name}`);
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}`);
      this.db.exec(`RELEASE ${name}`);
      callbacks.failed?.(error);
      return undefined;
    }
    this.pending.push({
      write,
      result,
      committed: callbacks.committed as ((r: unknown) => void) | undefined,
      failed: callbacks.failed,
    });
    return result;
  }

  /** Commit the group if it has been open for its budget (call between items). */
  maybeCommit(): void {
    if (this.openedAt !== null && this.now() - this.openedAt >= this.budgetMs) this.commit();
  }

  /** Commit the open group, if any (before copying media, at the end of a phase or run). */
  commit(): void {
    if (this.openedAt === null) return;
    const group = this.pending;
    this.pending = [];
    this.openedAt = null;
    try {
      this.db.exec('COMMIT');
    } catch {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      // Every item again, each on its own: only the ones that fail by themselves are lost.
      for (const item of group) {
        let result: unknown;
        try {
          result = this.db.transaction(item.write)();
        } catch (error) {
          item.failed?.(error);
          continue;
        }
        item.committed?.(result);
      }
      // Failures recorded during the retries opened a new group.
      this.commit();
      return;
    }
    for (const item of group) item.committed?.(item.result);
  }
}
