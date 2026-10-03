import type Database from 'better-sqlite3';
import { up as core } from './migrations/001-core';
import { up as imports } from './migrations/002-imports';
import { up as removal } from './migrations/003-removal';
import { up as slideCues } from './migrations/004-slide-cues';
import { up as list } from './migrations/005-list';
import { up as playable } from './migrations/006-playable';
import { up as arrangements } from './migrations/007-arrangements';
import { up as playlistEdits } from './migrations/008-playlists';
import { up as search } from './migrations/009-search';
import { up as slideEditor } from './migrations/010-slide-editor';
import { before as kirtanLibraryData, up as kirtanLibrary } from './migrations/011-kirtan-library';
import { up as screenLanguages } from './migrations/012-screen-languages';
import { up as searchDetails } from './migrations/013-search-details';
import { up as templates } from './migrations/014-templates';
import { up as listedKirtans } from './migrations/015-listed-kirtans';
import { up as streaming } from './migrations/016-streaming';
import { up as conversions } from './migrations/017-conversions';
import { up as network } from './migrations/018-network';
import { up as announcements } from './migrations/019-announcements';

export interface Migration {
  version: number;
  name: string;
  up: string;
  /** Data that must be moved in code before `up` runs (same transaction). */
  before?: (db: Database.Database) => void;
}

/** All migrations, oldest first. Never edit a released one; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'core model', up: core },
  { version: 2, name: 'imports', up: imports },
  { version: 3, name: 'removal', up: removal },
  { version: 4, name: 'slide cues', up: slideCues },
  { version: 5, name: 'cheap library list', up: list },
  { version: 6, name: 'playable media', up: playable },
  { version: 7, name: 'arrangements set the order', up: arrangements },
  { version: 8, name: 'playlists the operator edits', up: playlistEdits },
  { version: 9, name: 'search', up: search },
  { version: 10, name: 'the slide editor', up: slideEditor },
  { version: 11, name: 'the kirtan library', up: kirtanLibrary, before: kirtanLibraryData },
  { version: 12, name: 'languages per screen group', up: screenLanguages },
  { version: 13, name: 'search by kirtan details', up: searchDetails },
  { version: 14, name: 'sabha templates', up: templates },
  { version: 15, name: 'kirtan details on the library list', up: listedKirtans },
  { version: 16, name: 'streaming', up: streaming },
  { version: 17, name: 'converting media', up: conversions },
  { version: 18, name: 'the local network', up: network },
  { version: 19, name: 'announcements from phones', up: announcements },
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
      m.before?.(db);
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return { from, to: schemaVersion(db) };
}
