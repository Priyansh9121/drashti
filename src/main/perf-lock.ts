/*
 * The library's write lock as the main process sees it while the performance check measures (Session 58, h-stall2):
 * looked at every 100 ms without waiting (db/write-lock.ts's way: taken and let go at once, never waited for), each
 * span it stayed taken timed. A write of the main process that came then would have waited that long: on two busy
 * cores the import worker kept it 1-9 s at a time, and S57 measured 0.5-1.9 s stalls of the main process mid-import.
 * For the record, never judged.
 */

export interface LockWatchOptions {
  /** Whether the write lock is free this moment (never waits). */
  free: () => boolean;
  now?: () => number;
  everyMs?: number;
  every?: (ms: number, run: () => void) => () => void;
}

export class LockWatch {
  private stop: (() => void) | null = null;
  private takenSince: number | null = null;
  private readonly spans: number[] = [];
  private looks = 0;
  private taken = 0;

  constructor(private readonly o: LockWatchOptions) {}

  private now(): number {
    return (this.o.now ?? (() => performance.now()))();
  }

  /** The measuring begins. */
  begin(): void {
    this.end();
    this.spans.length = 0;
    this.looks = 0;
    this.taken = 0;
    this.takenSince = null;
    const every =
      this.o.every ??
      ((ms: number, run: () => void) => {
        const t = setInterval(run, ms);
        return () => {
          clearInterval(t);
        };
      });
    this.stop = every(this.o.everyMs ?? 100, () => {
      this.look();
    });
  }

  private look(): void {
    let free: boolean;
    try {
      free = this.o.free();
    } catch {
      return;
    }
    const now = this.now();
    this.looks += 1;
    if (!free) {
      this.taken += 1;
      this.takenSince ??= now;
    } else if (this.takenSince !== null) {
      this.spans.push(now - this.takenSince);
      this.takenSince = null;
    }
  }

  /** The measuring ends: stop looking (a span still open counts to now). */
  end(): void {
    this.stop?.();
    this.stop = null;
    if (this.takenSince !== null) {
      this.spans.push(this.now() - this.takenSince);
      this.takenSince = null;
    }
  }

  /** What it saw, in one line for the summary. */
  line(): string {
    const longest = this.spans.length > 0 ? Math.round(Math.max(...this.spans)) : 0;
    const over = (ms: number) => this.spans.filter((s) => s >= ms).length;
    return `the library’s write lock as the main process saw it (looked at every ${String(this.o.everyMs ?? 100)} ms, never waited for): taken at ${String(this.taken)} of ${String(this.looks)} looks, its longest hold ${String(longest)} ms, holds of 0.5/1/2 s or more: ${String(over(500))}/${String(over(1000))}/${String(over(2000))}`;
  }
}
