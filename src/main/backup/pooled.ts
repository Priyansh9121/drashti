import Database from 'better-sqlite3';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SCHEDULED_FOLDER } from '../../shared/backups';
import { fileStamp } from '../../shared/format';
import { filesIn, LIBRARY_FILE, MANIFEST, MEDIA, NOTE, readManifest, readNote } from '../library/backup';

/*
 * A scheduled backup (shared/backups.ts), as the backup worker makes it, in
 * the folder an admin chose:
 *
 *   Drashti scheduled backups/
 *     Media/                            shared: each file once, named by its hash
 *     Drashti backup 2026-10-06 23-00/  drashti.sqlite, media.json, backup.json
 *
 * The library is copied with SQLite's online backup; the media files the
 * shared folder does not have yet are copied into it (each to a temporary
 * name first, so a file cut short is never taken for a whole one); the
 * backup lists the files it needs (media.json), and its note (backup.json)
 * is written last. Then only the newest `keep` scheduled backups stay:
 * older ones Drashti made there go, and so does any shared media file that
 * no kept backup lists. Folders Drashti did not make are never touched.
 */

/** Written first into a scheduled backup's folder: only folders with it are ever removed. */
export const MARKER = '.drashti-scheduled';
const PART = '.part';

export class BackupStopped extends Error {
  constructor(
    readonly code: 'no-room' | 'cancelled' | 'no-folder',
    message: string,
  ) {
    super(message);
  }
}

export interface PooledOptions {
  /** The library file, opened here on a connection of its own. */
  dbFile: string;
  /** The media folder to copy from, or null for the library only. */
  mediaDir: string | null;
  /** The folder the admin chose. */
  root: string;
  keep: number;
  app: string;
  schema: number;
  now: Date;
  /** Free space to leave on that disk (2 GB on the library's own disk). */
  reserveBytes: number;
}

export interface PooledHooks {
  /** Waits while the backup must (the stream on air); resolves when it may go on. */
  gate(): Promise<void>;
  /** Each chunk copied: waits as long as keeping to the speed limit takes. */
  throttle(bytes: number): Promise<void>;
  progress(done: number, total: number): void;
  cancelled(): boolean;
  freeBytes(path: string): number;
}

export interface PooledResult {
  /** The new backup's folder name. */
  folder: string;
  /** Media files copied this time, and how many the backup lists. */
  copied: number;
  files: number;
  bytesCopied: number;
  /** Older scheduled backups removed, and shared media files no kept backup needed. */
  removed: number;
  poolRemoved: number;
}

/** A media file's path in a backup's list: with forward slashes on every system. */
const listed = (path: string) => path.split(sep).join('/');

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

/** A folder in `parent` that does not exist yet: "name", else "name (2)"... */
function freshFolder(parent: string, name: string): string {
  let folder = join(parent, name);
  for (let n = 2; existsSync(folder); n++) folder = join(parent, `${name} (${String(n)})`);
  return folder;
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

/** Back up into the scheduled folder, then keep only the newest `keep`. */
export async function pooledBackup(options: PooledOptions, hooks: PooledHooks): Promise<PooledResult> {
  const stop = () => {
    if (hooks.cancelled()) throw new BackupStopped('cancelled', 'The backup was stopped.');
  };
  if (!existsSync(options.root))
    throw new BackupStopped('no-folder', 'The backup folder is not there (is the drive connected?).');
  const scheduled = join(options.root, SCHEDULED_FOLDER);
  const pool = join(scheduled, MEDIA);
  await mkdir(pool, { recursive: true });
  const folder = freshFolder(scheduled, `Drashti backup ${fileStamp(options.now)}`);
  await mkdir(folder);
  await writeFile(join(folder, MARKER), `${JSON.stringify({ createdAt: options.now.toISOString() })}\n`);
  try {
    // What the shared folder does not have yet (the same name and size is the same file: named by its hash).
    const media = options.mediaDir && existsSync(options.mediaDir) ? await filesIn(options.mediaDir) : [];
    const toCopy: { path: string; bytes: number }[] = [];
    for (const f of media) if ((await sizeOf(join(pool, f.path))) !== f.bytes) toCopy.push(f);
    const total = toCopy.reduce((sum, f) => sum + f.bytes, 0);
    const libraryBytes = (await sizeOf(options.dbFile)) ?? 0;
    const usable = hooks.freeBytes(scheduled) - options.reserveBytes;
    if (total + libraryBytes > usable)
      throw new BackupStopped(
        'no-room',
        'There is not enough room on the backup drive (Drashti keeps free space there too).',
      );

    // The library, whole, while the show goes on.
    await hooks.gate();
    stop();
    const db = new Database(options.dbFile, { fileMustExist: true });
    try {
      db.pragma('busy_timeout = 5000');
      await db.backup(join(folder, LIBRARY_FILE));
    } finally {
      db.close();
    }

    // The media, one file at a time, at the speed allowed.
    let done = 0;
    let copied = 0;
    hooks.progress(0, total);
    for (const f of toCopy) {
      await hooks.gate();
      stop();
      const source = join(options.mediaDir ?? '', f.path);
      const target = join(pool, f.path);
      await mkdir(dirname(target), { recursive: true });
      try {
        await pipeline(
          createReadStream(source, { highWaterMark: 256 * 1024 }),
          new Transform({
            transform(chunk: Buffer, _encoding, next) {
              void (async () => {
                await hooks.gate();
                if (hooks.cancelled()) {
                  next(new BackupStopped('cancelled', 'The backup was stopped.'));
                  return;
                }
                await hooks.throttle(chunk.length);
                done += chunk.length;
                hooks.progress(done, total);
                next(null, chunk);
              })();
            },
          }),
          createWriteStream(`${target}${PART}`),
        );
        await rename(`${target}${PART}`, target);
        copied++;
      } catch (error) {
        await rm(`${target}${PART}`, { force: true });
        // Gone since the folder was read (a file replaced): it is not part of this backup.
        if (errorCode(error) === 'ENOENT' && !existsSync(source)) continue;
        throw error;
      }
    }
    // The files this backup needs: every media file that is now in the shared folder.
    const files: string[] = [];
    for (const f of media) if (existsSync(join(pool, f.path))) files.push(listed(f.path));
    await writeFile(join(folder, MANIFEST), `${JSON.stringify({ files })}\n`);
    // Written last: a folder without it is a backup that did not finish.
    await writeFile(
      join(folder, NOTE),
      `${JSON.stringify(
        {
          app: options.app,
          schema: options.schema,
          createdAt: options.now.toISOString(),
          media: options.mediaDir !== null,
          scheduled: true,
          ...(options.mediaDir !== null ? { mediaPool: `../${MEDIA}` } : {}),
        },
        null,
        2,
      )}\n`,
    );
    const pruned = await prune(scheduled, options.keep, folder);
    return {
      folder: folder.slice(scheduled.length + 1),
      copied,
      files: files.length,
      bytesCopied: done,
      ...pruned,
    };
  } catch (error) {
    // Nothing half-done is left to be taken for a backup (the shared files copied whole stay).
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Keep the newest `keep` finished scheduled backups in `scheduled` (and the
 * one just made); remove older ones and unfinished ones Drashti made, then
 * every shared media file no kept backup lists. Anything without Drashti's
 * marker is left alone.
 */
export async function prune(
  scheduled: string,
  keep: number,
  current: string,
): Promise<{ removed: number; poolRemoved: number }> {
  const finished: { dir: string; at: string }[] = [];
  let removed = 0;
  for (const entry of await readdir(scheduled, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === MEDIA) continue;
    const dir = join(scheduled, entry.name);
    if (!existsSync(join(dir, MARKER))) continue;
    const note = readNote(dir);
    if (note?.scheduled) finished.push({ dir, at: note.createdAt });
    else if (dir !== current) {
      // Cut short (Drashti stopped mid-backup): never a backup to restore.
      await rm(dir, { recursive: true, force: true });
      removed++;
    }
  }
  finished.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const kept = finished.filter((b, i) => i < keep || b.dir === current);
  for (const b of finished)
    if (!kept.includes(b)) {
      await rm(b.dir, { recursive: true, force: true });
      removed++;
    }
  // Shared media no kept backup lists. If any kept backup's list cannot be read, nothing goes.
  const needed = new Set<string>();
  for (const b of kept) {
    const files = readManifest(b.dir);
    if (files === null) return { removed, poolRemoved: 0 };
    for (const f of files) needed.add(f);
  }
  let poolRemoved = 0;
  const pool = join(scheduled, MEDIA);
  for (const f of await filesIn(pool))
    if (!needed.has(listed(f.path))) {
      await rm(join(pool, f.path), { force: true });
      poolRemoved++;
    }
  return { removed, poolRemoved };
}
