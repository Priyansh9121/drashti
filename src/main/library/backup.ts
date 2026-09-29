import Database from 'better-sqlite3';
import {
  constants,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { fileStamp } from '../../shared/format';
import type { Db } from '../db/database';

/*
 * Backing up and restoring the library. A backup is a folder: the database,
 * copied with SQLite's online backup (consistent even while Drashti runs),
 * the media folder when asked for, and a note written last, so a backup
 * that did not finish is never taken for one that did. A restore cannot
 * swap the files under an open library, so it is asked for and done at the
 * next start, before the library opens: everything is copied in beside the
 * library first, the current library is kept as a backup of its own, and
 * only then is the backup put in place.
 */

export const LIBRARY_FILE = 'drashti.sqlite';
const MEDIA = 'Media';
const REQUEST = 'restore-request.json';
const NOTE = 'backup.json';
/** Files this big are streamed, so the progress moves while they copy. */
const STREAM_FROM = 16 * 1024 * 1024;

export interface BackupNote {
  app: string;
  schema: number;
  createdAt: string;
  media: boolean;
}

const noteSchema: z.ZodType<BackupNote> = z.object({
  app: z.string(),
  schema: z.number().int(),
  createdAt: z.string(),
  media: z.boolean(),
});

const noteText = (note: BackupNote) => `${JSON.stringify(note, null, 2)}\n`;

/** A folder in `parent` that does not exist yet: "name", else "name (2)"... */
function freshFolder(parent: string, name: string): string {
  let folder = join(parent, name);
  for (let n = 2; existsSync(folder); n++) folder = join(parent, `${name} (${String(n)})`);
  return folder;
}

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

/** The files in a folder and below (regular files only, symbolic links not followed), with their sizes. */
export async function filesIn(dir: string): Promise<{ path: string; bytes: number }[]> {
  const found: { path: string; bytes: number }[] = [];
  const walk = async (at: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile())
        try {
          found.push({ path: relative(dir, full), bytes: (await stat(full)).size });
        } catch (error) {
          // Gone since the folder was read (a file being replaced): nothing to copy.
          if (errorCode(error) !== 'ENOENT') throw error;
        }
    }
  };
  await walk(dir);
  return found;
}

/** Copy a folder's files, reporting the bytes copied so far. */
async function copyFolder(
  from: string,
  to: string,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const files = await filesIn(from);
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  let done = 0;
  await mkdir(to, { recursive: true });
  for (const file of files) {
    const source = join(from, file.path);
    const target = join(to, file.path);
    await mkdir(dirname(target), { recursive: true });
    try {
      if (file.bytes < STREAM_FROM) {
        // A clone where the disk can (the same APFS volume), else a plain copy.
        await copyFile(source, target, constants.COPYFILE_FICLONE);
        done += file.bytes;
      } else {
        await pipeline(
          createReadStream(source, { highWaterMark: 1024 * 1024 }),
          new Transform({
            transform(chunk: Buffer, _encoding, next) {
              done += chunk.length;
              onProgress(done, total);
              next(null, chunk);
            },
          }),
          createWriteStream(target),
        );
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' || existsSync(source)) throw error;
    }
    onProgress(done, total);
  }
  return files.length;
}

export interface BackupOptions {
  /** The media folder to copy too, or null for the library only. */
  mediaDir: string | null;
  app: string;
  schema: number;
  now: Date;
  /** Media bytes copied so far, of the total. */
  onProgress?: (done: number, total: number) => void;
}

/** Back up into a new folder in `into`; returns that folder and how many media files went with it. */
export async function backupLibrary(
  db: Db,
  into: string,
  options: BackupOptions,
): Promise<{ folder: string; mediaFiles: number }> {
  const folder = freshFolder(into, `Drashti backup ${fileStamp(options.now)}`);
  await mkdir(folder, { recursive: true });
  try {
    await db.backup(join(folder, LIBRARY_FILE));
    const mediaDir = options.mediaDir !== null && existsSync(options.mediaDir) ? options.mediaDir : null;
    const mediaFiles = mediaDir
      ? await copyFolder(mediaDir, join(folder, MEDIA), options.onProgress ?? (() => undefined))
      : 0;
    // Written last: a folder without it is a backup that did not finish.
    await writeFile(
      join(folder, NOTE),
      noteText({
        app: options.app,
        schema: options.schema,
        createdAt: options.now.toISOString(),
        media: mediaDir !== null,
      }),
    );
    return { folder, mediaFiles };
  } catch (error) {
    // Nothing half-done is left behind to be taken for a backup later.
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

export type BackupCheck =
  | { ok: true; media: boolean; schema: number; note: BackupNote }
  | { ok: false; code: 'no-library' | 'unfinished' | 'unreadable' | 'newer'; message: string };

/** Whether a folder holds a finished backup this Drashti can restore. */
export function checkBackup(folder: string, latestSchema: number): BackupCheck {
  const file = join(folder, LIBRARY_FILE);
  if (!existsSync(file))
    return {
      ok: false,
      code: 'no-library',
      message: 'That folder is not a Drashti backup: it has no library (drashti.sqlite) in it.',
    };
  let note: BackupNote;
  try {
    note = noteSchema.parse(JSON.parse(readFileSync(join(folder, NOTE), 'utf8')));
  } catch {
    return {
      ok: false,
      code: 'unfinished',
      message: 'That backup did not finish (its backup.json note is missing), so it may not be whole.',
    };
  }
  let schema: number;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      schema = db.pragma('user_version', { simple: true }) as number;
    } finally {
      db.close();
    }
  } catch {
    return { ok: false, code: 'unreadable', message: 'The library in that backup cannot be read.' };
  }
  if (schema > latestSchema)
    return {
      ok: false,
      code: 'newer',
      message: 'That backup was made by a newer Drashti: update Drashti first.',
    };
  return { ok: true, media: existsSync(join(folder, MEDIA)), schema, note };
}

/** Ask for a restore from `from` at the next start. */
export function requestRestore(userData: string, from: string): void {
  writeFileSync(join(userData, REQUEST), JSON.stringify({ from }));
}

type CheckFailure = Extract<BackupCheck, { ok: false }>['code'];

export type RestoreOutcome =
  | { restored: false; code: null; message: null }
  | { restored: false; code: 'bad-request' | 'copy-failed' | 'swap-failed' | CheckFailure; message: string }
  | { restored: true; from: string; keptIn: string; media: boolean };

const reason = (error: unknown) => {
  const code = errorCode(error);
  if (code === 'ENOSPC') return 'the disk is full';
  if (code === 'EACCES' || code === 'EPERM') return 'a file could not be written (no permission, or in use)';
  if (code === 'ENOENT') return 'a file of the backup is missing';
  return code ?? 'an unexpected error';
};

/**
 * At start, before the library opens: carry out a restore that was asked
 * for. The current library (and its media, when the backup brings its own)
 * is kept in Backups/Before restore <date>, then the backup is put in place.
 */
export function applyPendingRestore(
  userData: string,
  options: { schema: number; app: string; now: Date },
): RestoreOutcome {
  const requestFile = join(userData, REQUEST);
  if (!existsSync(requestFile)) return { restored: false, code: null, message: null };
  let from = '';
  try {
    from = z.object({ from: z.string().min(1) }).parse(JSON.parse(readFileSync(requestFile, 'utf8'))).from;
  } catch {
    // Handled below.
  } finally {
    // Asked once: a problem below must not repeat at every start.
    rmSync(requestFile, { force: true });
  }
  if (!from)
    return {
      restored: false,
      code: 'bad-request',
      message: 'The library was not restored: the request to restore could not be read.',
    };
  const check = checkBackup(from, options.schema);
  if (!check.ok)
    return { restored: false, code: check.code, message: `The library was not restored. ${check.message}` };

  const current = join(userData, LIBRARY_FILE);
  const mediaDir = join(userData, MEDIA);
  const incomingDb = `${current}.restoring`;
  const incomingMedia = join(userData, `${MEDIA}.restoring`);
  const keptIn = freshFolder(join(userData, 'Backups'), `Before restore ${fileStamp(options.now)}`);
  const cleanUp = () => {
    rmSync(incomingMedia, { recursive: true, force: true });
    rmSync(incomingDb, { force: true });
  };

  // 1. Everything copied in beside the library first: if that fails, the library is as it was.
  try {
    mkdirSync(keptIn, { recursive: true });
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(`${current}${suffix}`))
        copyFileSync(`${current}${suffix}`, join(keptIn, `${LIBRARY_FILE}${suffix}`));
    rmSync(incomingMedia, { recursive: true, force: true });
    if (check.media) cpSync(join(from, MEDIA), incomingMedia, { recursive: true });
    copyFileSync(join(from, LIBRARY_FILE), incomingDb);
  } catch (error) {
    cleanUp();
    rmSync(keptIn, { recursive: true, force: true });
    return {
      restored: false,
      code: 'copy-failed',
      message: `The library was not restored: ${reason(error)}.`,
    };
  }

  // 2. Then put in place with renames, which are quick and whole. The old journal files go
  // first: left beside the restored library, SQLite would replay them into it.
  const undo: (() => void)[] = [];
  try {
    if (check.media) {
      if (existsSync(mediaDir)) {
        renameSync(mediaDir, join(keptIn, MEDIA));
        undo.push(() => {
          renameSync(join(keptIn, MEDIA), mediaDir);
        });
      }
      renameSync(incomingMedia, mediaDir);
      undo.push(() => {
        renameSync(mediaDir, incomingMedia);
      });
    }
    for (const suffix of ['-wal', '-shm']) rmSync(`${current}${suffix}`, { force: true });
    undo.push(() => {
      for (const suffix of ['-wal', '-shm'])
        if (existsSync(join(keptIn, `${LIBRARY_FILE}${suffix}`)))
          copyFileSync(join(keptIn, `${LIBRARY_FILE}${suffix}`), `${current}${suffix}`);
    });
    renameSync(incomingDb, current);
  } catch (error) {
    // Put back what had moved, as far as that goes; the message says where the old library is kept.
    try {
      for (const step of undo.reverse()) step();
    } catch {
      // Nothing more to try.
    }
    cleanUp();
    return {
      restored: false,
      code: 'swap-failed',
      message: `The library was not restored completely (${reason(error)}). The library from before is kept in Backups/${basename(keptIn)} in Drashti's data folder.`,
    };
  }
  writeFileSync(
    join(keptIn, NOTE),
    noteText({
      app: options.app,
      schema: options.schema,
      createdAt: options.now.toISOString(),
      media: existsSync(join(keptIn, MEDIA)),
    }),
  );
  return { restored: true, from: basename(from), keptIn: basename(keptIn), media: check.media };
}

/** Whether two paths are on the same disk (so a backup there takes room from the library's own disk). */
export function sameDisk(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}
