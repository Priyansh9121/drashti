import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { LATEST_VERSION, migrate, type Migration, MIGRATIONS, schemaVersion } from './migrate';

export type Db = Database.Database;

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
    db.pragma('busy_timeout = 5000');
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
