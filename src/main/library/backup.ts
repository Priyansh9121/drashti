import Database from 'better-sqlite3';
import {
  constants,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { fileStamp } from '../../shared/format';
import type { Db } from '../db/database';
import { CONVERTING_DIR, UPLOADS_DIR } from '../import/media-store';
import { SHARPENED_DIR } from '../media/sharpened';
import { BLURRED_DIR } from '../media/blurred';
import { realPlace } from '../media/contained';
import {
  ORIGINALS_STAGING_DIR,
  originalRelative,
  retainedOriginals,
  type OriginalDescriptor,
} from '../import/originals-store';
import {
  copyOriginalSet,
  freshOriginalSet,
  heldOriginals,
  mergeOriginalSetSync,
  namedOriginals,
  originalRoot,
  originalsPresent,
  originalSet,
  type LeftOutOriginal,
  type OriginalBackupSet,
} from './original-backup';

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
export const MEDIA = 'Media';
const REQUEST = 'restore-request.json';
export const NOTE = 'backup.json';
/** A scheduled backup's list of the media files it needs from the shared pool (Session 14). */
export const MANIFEST = 'media.json';
/** In the library kept before a restore: its damaged copies of originals the restore replaced (alpha.15). */
const DAMAGED_ORIGINALS = 'Damaged originals';
/** Files this big are streamed, so the progress moves while they copy. */
const STREAM_FROM = 16 * 1024 * 1024;

export interface BackupNote {
  app: string;
  schema: number;
  createdAt: string;
  media: boolean;
  /** Made by a schedule (Session 14): only these are ever removed by Drashti, in their folder. */
  scheduled?: boolean;
  /**
   * The media folder shared by the scheduled backups beside it (relative to
   * this backup, "../Media"), with MANIFEST listing the files this one needs.
   */
  mediaPool?: string;
  /** Required immutable sources, even in a library-only backup. */
  originals?: OriginalBackupSet;
  /**
   * Required originals missing or damaged in the library when the backup was made (alpha.15): left out, so
   * the library and everything else were still backed up. Not in `originals`; a check and a restore know.
   */
  originalsLeftOut?: LeftOutOriginal[];
}

const originalSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  ext: z.enum(['pdf', 'pptx', 'ppt', 'key']),
  bytes: z
    .number()
    .int()
    .positive()
    .max(1024 ** 3),
});

const noteSchema: z.ZodType<BackupNote> = z.object({
  app: z.string(),
  schema: z.number().int(),
  createdAt: z.string(),
  media: z.boolean(),
  scheduled: z.boolean().optional(),
  mediaPool: z.string().optional(),
  originals: z
    .object({
      version: z.literal(1),
      files: z.array(originalSchema).max(100_000),
    })
    .optional(),
  originalsLeftOut: z
    .array(originalSchema.extend({ name: z.string().max(1000).optional() }))
    .max(100_000)
    .optional(),
});

/** A note as it is read (null when it is missing or not a backup's note). */
export function readNote(folder: string): BackupNote | null {
  try {
    return noteSchema.parse(JSON.parse(readFileSync(join(folder, NOTE), 'utf8')));
  } catch {
    return null;
  }
}

const manifestSchema = z.object({ files: z.array(z.string().min(1).max(1024)).max(1_000_000) });

/** The media files a scheduled backup needs from its pool, or null when its list cannot be read. */
export function readManifest(folder: string): string[] | null {
  try {
    const files = manifestSchema.parse(JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8'))).files;
    // Only plain paths inside the pool: nothing that climbs out of it.
    return files.every((f) => !isAbsolute(f) && !f.split(/[\\/]/u).includes('..')) ? files : null;
  } catch {
    return null;
  }
}

/**
 * The copies openDatabase keeps before upgrading a library (drashti.sqlite.v<N>.bak). They
 * belong to the library beside them, and one already there stops the next upgrade making
 * its own, so they move with their library.
 */
function upgradeCopies(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => /^drashti\.sqlite\.v\d+\.bak$/u.test(name));
  } catch {
    return [];
  }
}

const noteText = (note: BackupNote) => `${JSON.stringify(note, null, 2)}\n`;

/** A folder in `parent` that does not exist yet: "name", else "name (2)"... */
function freshFolder(parent: string, name: string): string {
  let folder = join(parent, name);
  for (let n = 2; existsSync(folder); n++) folder = join(parent, `${name} (${String(n)})`);
  return folder;
}

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

/**
 * A media folder's folders that a backup leaves out: conversions going on (not the library's yet) and
 * pictures' sharpened copies (Session 26f: made again from the pictures after a restore), and (Session 54) files
 * phones are sending.
 */
// Blurred copies (Session 55, Part 5) are left out as the sharpened ones are: each can be made again.
const LEFT_OUT = new Set([CONVERTING_DIR, SHARPENED_DIR, BLURRED_DIR, UPLOADS_DIR, ORIGINALS_STAGING_DIR]);

/**
 * The files in a folder and below (regular files only, symbolic links not followed), with their sizes.
 * A media folder's conversions going on and sharpened copies are left out.
 */
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
      if (entry.isDirectory()) {
        if (at === dir && LEFT_OUT.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile())
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

/**
 * Back up into a new folder in `into`; returns that folder, how many media files went with it, and (alpha.15)
 * the required originals left out because they were missing or damaged in the library.
 */
export async function backupLibrary(
  db: Db,
  into: string,
  options: BackupOptions,
): Promise<{ folder: string; mediaFiles: number; originalsLeftOut?: LeftOutOriginal[] }> {
  const folder = freshFolder(into, `Drashti backup ${fileStamp(options.now)}`);
  await mkdir(folder, { recursive: true });
  try {
    await db.backup(join(folder, LIBRARY_FILE));
    const originals = freshOriginalSet(join(folder, LIBRARY_FILE));
    const originalMedia = originalRoot(db.name, options.mediaDir);
    const mediaDir = options.mediaDir !== null && existsSync(options.mediaDir) ? options.mediaDir : null;
    let mediaFiles = mediaDir
      ? await copyFolder(mediaDir, join(folder, MEDIA), options.onProgress ?? (() => undefined))
      : 0;
    let held = originals;
    let leftOut: LeftOutOriginal[] = [];
    if (originals) {
      if (!originalMedia) throw new Error('The library has no managed folder for its required originals.');
      // One missing or damaged never stops the backup (alpha.15): it is left out, and the note says which.
      const missing = await copyOriginalSet(originalMedia, join(folder, MEDIA), originals);
      if (missing.length) {
        held = heldOriginals(originals, missing);
        leftOut = namedOriginals(join(folder, LIBRARY_FILE), missing);
        // A damaged one the media copy took is not kept as if it were the original.
        for (const original of missing) {
          const copy = join(folder, MEDIA, originalRelative(original));
          if (existsSync(copy)) {
            await rm(copy, { force: true });
            mediaFiles--;
          }
        }
      }
    }
    // Written last: a folder without it is a backup that did not finish.
    await writeFile(
      join(folder, NOTE),
      noteText({
        app: options.app,
        schema: options.schema,
        createdAt: options.now.toISOString(),
        media: mediaDir !== null,
        ...(held ? { originals: held } : {}),
        ...(leftOut.length ? { originalsLeftOut: leftOut } : {}),
      }),
    );
    return { folder, mediaFiles, ...(leftOut.length ? { originalsLeftOut: leftOut } : {}) };
  } catch (error) {
    // Nothing half-done is left behind to be taken for a backup later.
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

export type BackupCheck =
  | {
      ok: true;
      media: boolean;
      schema: number;
      note: BackupNote;
      /** A scheduled backup's media: the pool folder and the files it needs there (else null). */
      pool: { dir: string; files: string[] } | null;
      originals?: { root: string; set: OriginalBackupSet };
    }
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
  let required: OriginalBackupSet | undefined;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      schema = db.pragma('user_version', { simple: true }) as number;
      const files = schema <= latestSchema ? retainedOriginals(db) : [];
      if (files.length) required = { version: 1, files };
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
  // Each original the library needs is in the backup, or (alpha.15) listed as left out when it was made.
  const listedIn = (list: readonly OriginalDescriptor[] | undefined, original: OriginalDescriptor) =>
    list?.some(
      (listed) =>
        listed.sha256 === original.sha256 && listed.ext === original.ext && listed.bytes === original.bytes,
    ) ?? false;
  if (
    required &&
    !required.files.every(
      (original) => listedIn(note.originals?.files, original) || listedIn(note.originalsLeftOut, original),
    )
  )
    return {
      ok: false,
      code: 'unfinished',
      message:
        'That backup is not whole: it does not list every original document its library needs (the PDF and PowerPoint files kept for editing), so it cannot be restored.',
    };
  let pool: { dir: string; files: string[] } | null = null;
  if (
    !existsSync(join(folder, MEDIA)) &&
    note.mediaPool !== undefined &&
    (note.media || (note.originals?.files.length ?? 0) > 0)
  ) {
    if (note.originals && note.mediaPool !== '../Media')
      return {
        ok: false,
        code: 'unfinished',
        message:
          'That backup’s media is not where Drashti keeps it (the shared Media folder beside it), so it cannot be restored whole.',
      };
    const dir = join(folder, note.mediaPool);
    const files = readManifest(folder);
    if (!files?.every((file) => existsSync(join(dir, file))))
      return {
        ok: false,
        code: 'unfinished',
        message:
          'That backup’s media is not all there (the shared Media folder beside it is missing files), so it cannot be restored whole.',
      };
    if (
      note.originals &&
      !note.originals.files.every((original) =>
        files.includes(originalRelative(original).split(/[\\/]/u).join('/')),
      )
    )
      return {
        ok: false,
        code: 'unfinished',
        message:
          'That backup’s media is not all there (its list of shared files leaves out an original document its library needs), so it cannot be restored whole.',
      };
    pool = { dir, files };
  }
  const media = note.originals ? note.media : pool !== null || existsSync(join(folder, MEDIA));
  if (media && !pool && !existsSync(join(folder, MEDIA)))
    return { ok: false, code: 'unfinished', message: 'The backup’s media is missing.' };
  const root = pool?.dir ?? join(folder, MEDIA);
  if (note.originals && !realPlace(pool ? dirname(folder) : folder, root)?.inside)
    return {
      ok: false,
      code: 'unfinished',
      message:
        'That backup’s Media folder leads outside the backup (it is a link to another place), so it cannot be restored.',
    };
  if (note.originals && !originalsPresent(root, note.originals))
    return {
      ok: false,
      code: 'unfinished',
      message:
        'That backup is not whole: an original document it lists (a PDF or PowerPoint file kept for editing) is missing from it, so it cannot be restored.',
    };
  return {
    ok: true,
    media,
    schema,
    note,
    pool,
    ...(note.originals ? { originals: { root, set: note.originals } } : {}),
  };
}

/** Ask for a restore from `from` at the next start. */
export function requestRestore(userData: string, from: string): void {
  writeFileSync(join(userData, REQUEST), JSON.stringify({ from }));
}

type CheckFailure = Extract<BackupCheck, { ok: false }>['code'];

export type RestoreOutcome =
  | { restored: false; code: null; message: null }
  | { restored: false; code: 'bad-request' | 'copy-failed' | 'swap-failed' | CheckFailure; message: string }
  | {
      restored: true;
      from: string;
      keptIn: string;
      media: boolean;
      /** The current library's originals that were missing or damaged, so not in its kept copy (alpha.15). */
      originalsNotKept?: number;
    };

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
  let previousOriginals: OriginalBackupSet | undefined;
  let notKept: LeftOutOriginal[] = [];
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
    if (check.pool && check.media) {
      // A scheduled backup: the files it lists, from the pool shared by the backups beside it.
      for (const file of check.pool.files) {
        mkdirSync(dirname(join(incomingMedia, file)), { recursive: true });
        copyFileSync(join(check.pool.dir, file), join(incomingMedia, file));
      }
      mkdirSync(incomingMedia, { recursive: true });
    } else if (check.media) cpSync(join(from, MEDIA), incomingMedia, { recursive: true });
    if (check.originals) mergeOriginalSetSync(check.originals.root, incomingMedia, check.originals.set);
    try {
      previousOriginals = originalSet(current);
    } catch {
      // A damaged current DB must not prevent recovery from a good backup; its bytes are kept for diagnosis.
      // An originals-only restore leaves the current Media tree, including every old original, in place.
      previousOriginals = undefined;
    }
    if (!check.media && previousOriginals) {
      // One missing or damaged in the current library never stops restoring a good backup (alpha.15): the
      // others are kept, and the kept copy's note says which it lacks.
      const missing = mergeOriginalSetSync(mediaDir, join(keptIn, MEDIA), previousOriginals, {
        leaveOutBad: true,
      });
      if (missing.length) notKept = namedOriginals(current, missing);
    }
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
    // A damaged copy in the current library where the backup's whole one goes is kept aside with the library
    // from before, and replaced (alpha.15).
    if (!check.media && check.originals)
      mergeOriginalSetSync(incomingMedia, mediaDir, check.originals.set, {
        moveBadTo: join(keptIn, DAMAGED_ORIGINALS),
      });
    for (const name of upgradeCopies(userData)) {
      renameSync(join(userData, name), join(keptIn, name));
      undo.push(() => {
        renameSync(join(keptIn, name), join(userData, name));
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
      message: `The library was not restored completely (${reason(error)}). The library from before is kept in Backups/${basename(keptIn)} in Drashti’s data folder.`,
    };
  }
  const keptOriginals =
    previousOriginals && notKept.length ? heldOriginals(previousOriginals, notKept) : previousOriginals;
  writeFileSync(
    join(keptIn, NOTE),
    noteText({
      app: options.app,
      schema: options.schema,
      createdAt: options.now.toISOString(),
      media: check.media && existsSync(join(keptIn, MEDIA)),
      ...(keptOriginals ? { originals: keptOriginals } : {}),
      ...(notKept.length ? { originalsLeftOut: notKept } : {}),
    }),
  );
  cleanUp();
  return {
    restored: true,
    from: basename(from),
    keptIn: basename(keptIn),
    media: check.media,
    ...(notKept.length ? { originalsNotKept: notKept.length } : {}),
  };
}

export type RollBackOutcome = { ok: true; failedIn: string } | { ok: false; message: string };

/**
 * After a restore whose library will not open: put back the library (and the
 * media, when the restore swapped it) kept in Backups/<keptIn>. The restored
 * copy that failed goes to Backups/Failed restore <date>, for diagnosis; the
 * backup it came from is untouched. The kept folder stays a finished backup.
 */
export function rollBackRestore(userData: string, keptIn: string, options: { now: Date }): RollBackOutcome {
  const backups = join(userData, 'Backups');
  const kept = join(backups, keptIn);
  const current = join(userData, LIBRARY_FILE);
  const mediaDir = join(userData, MEDIA);
  if (!existsSync(join(kept, LIBRARY_FILE)))
    return { ok: false, message: `The library from before the restore is not in Backups/${keptIn}.` };
  const failedIn = freshFolder(backups, `Failed restore ${fileStamp(options.now)}`);
  try {
    mkdirSync(failedIn, { recursive: true });
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(`${current}${suffix}`))
        renameSync(`${current}${suffix}`, join(failedIn, `${LIBRARY_FILE}${suffix}`));
    // Upgrade copies made while trying to open the restored library go with it; the old ones come back.
    for (const name of upgradeCopies(userData)) renameSync(join(userData, name), join(failedIn, name));
    for (const name of upgradeCopies(kept)) renameSync(join(kept, name), join(userData, name));
    const keptNote = readNote(kept);
    if (existsSync(join(kept, MEDIA)) && (!keptNote?.originals || keptNote.media)) {
      if (existsSync(mediaDir)) renameSync(mediaDir, join(failedIn, MEDIA));
      renameSync(join(kept, MEDIA), mediaDir);
    }
    if (keptNote?.originals && !keptNote.media)
      mergeOriginalSetSync(join(kept, MEDIA), mediaDir, keptNote.originals);
    // Copied, not moved: the kept folder stays a backup of the library from before.
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(join(kept, `${LIBRARY_FILE}${suffix}`)))
        copyFileSync(join(kept, `${LIBRARY_FILE}${suffix}`), `${current}${suffix}`);
    const note = noteSchema.safeParse(JSON.parse(readFileSync(join(kept, NOTE), 'utf8')));
    if (note.success)
      writeFileSync(
        join(kept, NOTE),
        noteText({
          ...note.data,
          media: note.data.originals ? note.data.media : existsSync(join(kept, MEDIA)),
        }),
      );
  } catch (error) {
    return {
      ok: false,
      message: `The library from before the restore could not be put back (${reason(error)}). It is kept in Backups/${keptIn} in Drashti’s data folder.`,
    };
  }
  return { ok: true, failedIn: basename(failedIn) };
}

/** Whether two paths are on the same disk (so a backup there takes room from the library's own disk). */
export function sameDisk(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}
