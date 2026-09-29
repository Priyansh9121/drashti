import type Database from 'better-sqlite3';
import { up as core } from './migrations/001-core';
import { up as imports } from './migrations/002-imports';
import { up as removal } from './migrations/003-removal';
import { up as slideCues } from './migrations/004-slide-cues';
import { up as list } from './migrations/005-list';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/** All migrations, oldest first. Never edit a released one; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'core model', up: core },
  { version: 2, name: 'imports', up: imports },
  { version: 3, name: 'removal', up: removal },
  { version: 4, name: 'slide cues', up: slideCues },
  { version: 5, name: 'cheap library list', up: list },
];

export const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

export function schemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Bring the database up to the latest version, one transaction per
 * migration. Refuses a database written by a newer Drashti.
 */
export function migrate(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): { from: number; to: number } {
  const from = schemaVersion(db);
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  if (from > latest) {
    throw new Error(
      `This database was written by a newer Drashti (schema ${from}; this version knows ${latest}).`,
    );
  }
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return { from, to: schemaVersion(db) };
}
