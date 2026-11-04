import type { Db } from '../db/database';
import { LIBRARY_BUSY_TIMEOUT_MS } from '../db/database';
import { isBusy } from '../db/later-writes';

export interface SourceCommitGuard {
  signal: AbortSignal;
  allowed(): boolean;
}
export type SourceWrite = <T>(guard: SourceCommitGuard, write: () => T) => Promise<T>;
interface GiveWay {
  ready: Promise<void>;
  done(): void;
}

/** Filesystem staging has finished before this hook; only a small synchronous addStaged batch belongs here. */
export function sourceWrite(db: Db, giveWay?: () => GiveWay, timeoutMs = 1_500): SourceWrite {
  return async <T>(guard: SourceCommitGuard, write: () => T): Promise<T> => {
    if (db.inTransaction) throw new Error('Source preparation cannot enter another library transaction.');
    const until = performance.now() + timeoutMs;
    let way: GiveWay | undefined;
    try {
      for (;;) {
        if (guard.signal.aborted || !guard.allowed())
          throw new Error('Source preparation is no longer allowed.');
        db.pragma('busy_timeout = 0');
        try {
          return db
            .transaction(() => {
              if (guard.signal.aborted || !guard.allowed())
                throw new Error('Source preparation is no longer allowed.');
              return write();
            })
            .immediate();
        } catch (error) {
          if (!isBusy(error)) throw error;
        } finally {
          db.pragma(`busy_timeout = ${String(LIBRARY_BUSY_TIMEOUT_MS)}`);
        }
        if (performance.now() >= until)
          throw new Error('The library is busy. Saved playback is unchanged; retry source preparation.');
        way ??= giveWay?.();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      way?.done();
    }
  };
}

export const unavailableSourceWrite: SourceWrite = () =>
  Promise.reject(new Error('Source asset writing is unavailable.'));
