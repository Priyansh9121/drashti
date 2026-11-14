import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { LATEST_VERSION, migrate, type Migration, MIGRATIONS, schemaVersion } from './migrate';

export type Db = Database.Database;

/** How long a write in this process waits for another's write lock (the import's) before failing. */
export const LIBRARY_BUSY_TIMEOUT_MS = 5000;

/** SQLite's own default (wal_autocheckpoint): a commit that finds the WAL this many pages long copies it in. */
export const CHECKPOINT_PAGES = 1000;

/**
 * Who copies the WAL into the library file while an import runs (Session 58, h-stall2). SQLite does it in whichever
 * connection's commit finds the WAL past CHECKPOINT_PAGES pages: during an import that was the main process's next
 * write (a later write's bookkeeping, a setting), which then copied the import's pages into the library file and
 * waited for the disk on the main thread, the one that carries every slide change (on two-core Windows streaming, a
 * 0.5-1.9 s stall in the middle of an import, the main thread off the processor). So while an import's worker runs,
 * Main's connection leaves the copying to the import's own (its commits do it in its process, and it copies what is
 * left as it ends: import/worker.ts), and does it again by itself once the import has ended. Nothing is lost either
 * way: a commit is in the WAL, read from there and kept there until it is copied, after a crash too.
 * Returns what the import service calls as a worker starts (true) and ends (false).
 */
export function leaveCopyingToImports(db: Db): (importing: boolean) => void {
  return (importing) => {
    // Closed as Drashti quits: nothing to copy, it was copied as it closed.
    if (!db.open) return;
    db.pragma(`wal_autocheckpoint = ${importing ? '0' : String(CHECKPOINT_PAGES)}`);
  };
}

/**
 * Make every transaction on this connection take the write lock at its
 * start (BEGIN IMMEDIATE). Two connections write the library: the main
 * process and the import worker (which calls this on its own). A transaction begun as a reader cannot
 * become a writer once the other connection has written since it began
 * (SQLITE_BUSY_SNAPSHOT, which no busy timeout waits out), so a read-then-
 * write change made during an import could fail. Taking the lock first, it
 * waits for the other's group to commit instead. Nested transactions are
 * savepoints whatever their kind, as before.
 */
export function beginImmediately(db: Db): void {
  const make = db.transaction.bind(db);
  db.transaction = ((fn: Parameters<Db['transaction']>[0]) => {
    const t = make(fn);
    const run = (...args: unknown[]): unknown => t.immediate(...args);
    return Object.assign(run, {
      default: run,
      deferred: (...args: unknown[]): unknown => t.deferred(...args),
      immediate: run,
      exclusive: (...args: unknown[]): unknown => t.exclusive(...args),
    });
  }) as Db['transaction'];
}

/**
 * Open (or create) the Drashti database, apply pragmas and migrations.
 * Before upgrading an existing database it writes a consistent copy next
 * to it (`<file>.v<old>.bak`), so a failed upgrade can never lose the library.
 */
export function openDatabase(file: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${String(LIBRARY_BUSY_TIMEOUT_MS)}`);
    beginImmediately(db);
    const current = schemaVersion(db);
    const latest = Math.max(0, ...migrations.map((m) => m.version));
    if (file !== ':memory:' && current > 0 && current < latest) {
      const backup = `${file}.v${current}.bak`;
      if (!existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup);
    }
    migrate(db, migrations);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export { LATEST_VERSION };
