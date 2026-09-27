import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { LATEST_VERSION, migrate, type Migration, MIGRATIONS, schemaVersion } from './migrate';

export type Db = Database.Database;

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
