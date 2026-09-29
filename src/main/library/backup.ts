import Database from 'better-sqlite3';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Db } from '../db/database';

/*
 * Backing up and restoring the library. A backup is a folder: the database,
 * copied with SQLite's online backup (consistent even while Drashti runs),
 * the media folder when asked for, and a note of what it is. A restore
 * cannot swap the files under an open library, so it is asked for and done
 * at the next start, before the library opens: the current library is kept
 * as a backup of its own first.
 */

export const LIBRARY_FILE = 'drashti.sqlite';
const REQUEST = 'restore-request.json';
const NOTE = 'backup.json';

export interface BackupNote {
  app: string;
  schema: number;
  createdAt: string;
  media: boolean;
}

const stamp = (now: Date) => now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');

/** A folder in `parent` that does not exist yet: "name", else "name (2)"... */
function freshFolder(parent: string, name: string): string {
  let folder = join(parent, name);
  for (let n = 2; existsSync(folder); n++) folder = join(parent, `${name} (${n})`);
  return folder;
}

/** Back up into a new folder in `into`; returns that folder. */
export async function backupLibrary(
  db: Db,
  into: string,
  options: { mediaDir: string | null; app: string; schema: number; now: Date },
): Promise<string> {
  const folder = freshFolder(into, `Drashti backup ${stamp(options.now)}`);
  await mkdir(folder, { recursive: true });
  await db.backup(join(folder, LIBRARY_FILE));
  if (options.mediaDir && existsSync(options.mediaDir))
    await cp(options.mediaDir, join(folder, 'Media'), { recursive: true });
  const note: BackupNote = {
    app: options.app,
    schema: options.schema,
    createdAt: options.now.toISOString(),
    media: options.mediaDir !== null,
  };
  await writeFile(join(folder, NOTE), `${JSON.stringify(note, null, 2)}\n`);
  return folder;
}

export type BackupCheck = { ok: true; media: boolean; schema: number } | { ok: false; message: string };

/** Whether a folder holds a library this Drashti can restore. */
export function checkBackup(folder: string, latestSchema: number): BackupCheck {
  const file = join(folder, LIBRARY_FILE);
  if (!existsSync(file))
    return { ok: false, message: 'That folder has no Drashti library in it (drashti.sqlite).' };
  let schema: number;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      schema = db.pragma('user_version', { simple: true }) as number;
    } finally {
      db.close();
    }
  } catch {
    return { ok: false, message: 'The library in that folder cannot be read.' };
  }
  if (schema > latestSchema)
    return { ok: false, message: 'That backup was made by a newer Drashti; update Drashti first.' };
  return { ok: true, media: existsSync(join(folder, 'Media')), schema };
}

/** Ask for a restore from `from` at the next start. */
export function requestRestore(userData: string, from: string): void {
  writeFileSync(join(userData, REQUEST), JSON.stringify({ from }));
}

export type RestoreOutcome =
  | { restored: false; message: string | null }
  | { restored: true; from: string; keptIn: string; media: boolean };

/**
 * At start, before the library opens: carry out a restore that was asked
 * for. The current library (and its media, when the backup brings its own)
 * is kept in Backups/Before restore <date>, then the backup is put in place.
 */
export function applyPendingRestore(userData: string, latestSchema: number, now: Date): RestoreOutcome {
  const requestFile = join(userData, REQUEST);
  if (!existsSync(requestFile)) return { restored: false, message: null };
  let from: string;
  try {
    from = (JSON.parse(readFileSync(requestFile, 'utf8')) as { from?: string }).from ?? '';
  } finally {
    // Asked once: a problem below must not repeat at every start.
    rmSync(requestFile, { force: true });
  }
  const check = checkBackup(from, latestSchema);
  if (!check.ok) return { restored: false, message: `The library was not restored: ${check.message}` };

  const keptIn = freshFolder(join(userData, 'Backups'), `Before restore ${stamp(now)}`);
  mkdirSync(keptIn, { recursive: true });
  const current = join(userData, LIBRARY_FILE);
  for (const suffix of ['', '-wal', '-shm'])
    if (existsSync(`${current}${suffix}`))
      copyFileSync(`${current}${suffix}`, join(keptIn, `${LIBRARY_FILE}${suffix}`));
  const mediaDir = join(userData, 'Media');
  if (check.media && existsSync(mediaDir)) renameSync(mediaDir, join(keptIn, 'Media'));
  writeFileSync(
    join(keptIn, NOTE),
    `${JSON.stringify({ app: 'Drashti', schema: latestSchema, createdAt: now.toISOString(), media: check.media }, null, 2)}\n`,
  );

  // The backup's database in place (whole, then renamed over), with the old journal files gone.
  const incoming = `${current}.restoring`;
  copyFileSync(join(from, LIBRARY_FILE), incoming);
  for (const suffix of ['-wal', '-shm']) rmSync(`${current}${suffix}`, { force: true });
  renameSync(incoming, current);
  if (check.media) cpSync(join(from, 'Media'), mediaDir, { recursive: true });
  return { restored: true, from: basename(from), keptIn, media: check.media };
}
