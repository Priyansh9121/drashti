import type { Db } from './database';
import { isBusy } from './later-writes';

/*
 * The library's write lock, looked at without waiting (Session 16). While an
 * import runs its worker holds the lock for each group it writes; a write in
 * the main process that waited for it there would hold up everything else
 * (every slide change) with it. So before an operator's edit writes, the main
 * process looks: free, and the edit goes at once (as it usually does); taken,
 * and it asks the import to give way and looks again every few milliseconds,
 * never waiting, until the lock is free.
 */

/** Whether the write lock is free this moment: taken and let go at once, never waited for. */
export function writeLockFree(db: Db, busyTimeoutMs: number): boolean {
  if (db.inTransaction) return true;
  db.pragma('busy_timeout = 0');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return true;
  } catch (error) {
    if (isBusy(error)) return false;
    throw error;
  } finally {
    db.pragma(`busy_timeout = ${String(busyTimeoutMs)}`);
  }
}

/**
 * Resolves as soon as `free()` says so, looking every `everyMs`, or when
 * `ready` resolves (the import has given way, or the wait reached its limit):
 * 'free' when the lock was seen free first.
 */
export function whenFree(
  free: () => boolean,
  ready: Promise<void>,
  everyMs = 5,
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
): Promise<'free' | 'ready'> {
  return new Promise((resolve) => {
    let settled = false;
    void ready.then(() => {
      if (settled) return;
      settled = true;
      resolve('ready');
    });
    const look = () => {
      if (settled) return;
      if (free()) {
        settled = true;
        resolve('free');
        return;
      }
      schedule(look, everyMs);
    };
    schedule(look, everyMs);
  });
}
