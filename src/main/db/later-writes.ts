import type { Db } from './database';

/*
 * Writes the show makes by itself (Session 15): a file's length learned as it
 * plays, the music played last, a playlist opened, when phones and nodes were
 * last seen, the mode. None of them may ever stop the main process, which
 * carries every slide change. During an import the import worker holds the
 * library's write lock while it writes each group (on Windows a commit can
 * take a third of a second), and a write in the main process would wait for
 * it there, synchronously: the performance check measured the screens
 * waiting 0.4 to 0.6 s for the music's own bookkeeping. So these writes are
 * tried at once without waiting, and when the library is busy, tried again
 * a moment later; the newest write for a thing replaces one still waiting.
 */

/** How long before a write the library was too busy for is tried again. */
export const RETRY_MS = 50;

/** SQLite's answer while another connection holds the write lock (and no wait was allowed). */
export function isBusy(error: unknown): boolean {
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  return code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED');
}

export interface LaterWritesOptions {
  /** The connection's usual busy timeout (ms), put back after each try. */
  busyTimeoutMs: number;
  retryMs?: number;
  /** Told when a write failed for another reason (it is dropped: it is only bookkeeping). */
  warn?: (message: string) => void;
  schedule?: (run: () => void, ms: number) => unknown;
}

export class LaterWrites {
  private readonly waiting = new Map<string, () => void>();
  private armed = false;
  /** Set by the quit's flush: later writes are dropped. */
  private closed = false;

  constructor(
    private readonly db: Db,
    private readonly options: LaterWritesOptions,
  ) {}

  /** Writes waiting for the library (for tests and diagnostics). */
  get pending(): number {
    return this.waiting.size;
  }

  /**
   * Write now if the library is free, otherwise a moment later. `key` names
   * what is written: a newer write for it replaces one still waiting.
   */
  write(key: string, run: () => void): void {
    // After the quit's flush, or with the library closed, a write is dropped, saying so, and never
    // throws (Session 17: the nodes' "last seen", saved at quit after the library had closed, was an
    // uncaught exception in the main process).
    if (this.closed || !this.db.open) {
      this.options.warn?.(`A later write (${key}) was not made: the library is closed`);
      return;
    }
    this.waiting.delete(key);
    // Writes for other things that are waiting go first, so nothing jumps the queue.
    if (this.waiting.size === 0 && this.attempt(key, run)) return;
    this.waiting.set(key, run);
    this.arm();
  }

  /** At quit: whatever is still waiting is written, waiting for the library if it must. */
  flush(): void {
    this.closed = true;
    for (const [key, run] of this.waiting) {
      try {
        run();
      } catch (error) {
        this.options.warn?.(`A later write (${key}) was not made: ${(error as Error).message}`);
      }
    }
    this.waiting.clear();
  }

  /** True once written (or given up on); false while the library is busy. */
  private attempt(key: string, run: () => void): boolean {
    this.db.pragma('busy_timeout = 0');
    try {
      run();
      return true;
    } catch (error) {
      if (isBusy(error)) return false;
      this.options.warn?.(`A later write (${key}) was not made: ${(error as Error).message}`);
      return true;
    } finally {
      this.db.pragma(`busy_timeout = ${String(this.options.busyTimeoutMs)}`);
    }
  }

  private arm(): void {
    if (this.armed) return;
    this.armed = true;
    const schedule = this.options.schedule ?? ((f: () => void, ms: number) => setTimeout(f, ms));
    schedule(() => {
      this.armed = false;
      if (this.closed || !this.db.open) return;
      for (const [key, run] of this.waiting) {
        if (!this.attempt(key, run)) break;
        this.waiting.delete(key);
      }
      if (this.waiting.size > 0) this.arm();
    }, this.options.retryMs ?? RETRY_MS);
  }
}
