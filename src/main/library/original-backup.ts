import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { copyFile, link, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  originalRelative,
  ORIGINALS_DIR,
  retainedOriginals,
  validOriginal,
  verifiedOriginal,
  type OriginalDescriptor,
} from '../import/originals-store';
import { realPlace } from '../media/contained';

export interface OriginalBackupSet {
  version: 1;
  files: OriginalDescriptor[];
}
export function originalSet(dbFile: string): OriginalBackupSet | undefined {
  if (dbFile === ':memory:' || !existsSync(dbFile)) return undefined;
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const files = retainedOriginals(db);
    return files.length ? { version: 1, files } : undefined;
  } finally {
    db.close();
  }
}
/** Only for a new snapshot this backup operation just created, never a user's existing backup. */
export function freshOriginalSet(dbFile: string): OriginalBackupSet | undefined {
  const db = new Database(dbFile, { fileMustExist: true });
  try {
    // The online copy inherits WAL mode. Normalize our copy before any read-only inspector can create sidecars.
    db.pragma('journal_mode = DELETE');
    const files = retainedOriginals(db);
    return files.length ? { version: 1, files } : undefined;
  } finally {
    db.close();
  }
}
export function originalRoot(dbFile: string, mediaDir: string | null): string | null {
  return mediaDir ?? (dbFile === ':memory:' ? null : join(dirname(dbFile), 'Media'));
}
export function originalsPresent(mediaDir: string, set: OriginalBackupSet): boolean {
  return set.files.every((original) => {
    if (!validOriginal(original)) return false;
    const place = realPlace(mediaDir, join(mediaDir, originalRelative(original)));
    try {
      return (
        place?.inside === true &&
        statSync(place.path).isFile() &&
        statSync(place.path).size === original.bytes
      );
    } catch {
      return false;
    }
  });
}
function folder(mediaDir: string, original: OriginalDescriptor): string {
  mkdirSync(mediaDir, { recursive: true });
  const originals = join(mediaDir, ORIGINALS_DIR);
  mkdirSync(originals, { recursive: true });
  if (!realPlace(mediaDir, originals)?.inside)
    throw new Error('The original folder leaves the managed library.');
  const target = join(mediaDir, originalRelative(original));
  mkdirSync(dirname(target), { recursive: true });
  if (!realPlace(mediaDir, dirname(target))?.inside)
    throw new Error('The original folder leaves the managed library.');
  return target;
}
export async function copyOriginalSet(from: string, into: string, set: OriginalBackupSet): Promise<void> {
  for (const original of set.files) {
    const source = await verifiedOriginal(from, original);
    if (!source) throw new Error('A required retained original is missing or damaged.');
    const target = folder(into, original);
    if (existsSync(target)) {
      if (!(await verifiedOriginal(into, original)))
        throw new Error('A retained original at the destination is damaged.');
      continue;
    }
    const partial = join(dirname(target), `.original-${randomUUID()}.part`);
    try {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, partial);
      try {
        await link(partial, target);
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : null;
        if (code !== 'EEXIST') {
          // USB filesystems such as exFAT/FAT need no hard links. The completion note is still written only
          // after this exclusive copy and its digest verification have finished; an existing file is never overwritten.
          if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'].includes(String(code))) throw error;
          try {
            await copyFile(partial, target, constants.COPYFILE_EXCL);
          } catch (copyError) {
            if (!(copyError instanceof Error && 'code' in copyError && copyError.code === 'EEXIST'))
              throw copyError;
          }
        }
      }
      if (!(await verifiedOriginal(into, original)))
        throw new Error('A retained original could not be copied whole.');
    } finally {
      await rm(partial, { force: true }).catch(() => undefined);
    }
  }
}
function verifiedSync(mediaDir: string, original: OriginalDescriptor): string {
  const place = realPlace(mediaDir, join(mediaDir, originalRelative(original)));
  if (!place?.inside || !statSync(place.path).isFile())
    throw new Error('A retained original leaves the managed library.');
  const hash = createHash('sha256');
  const file = openSync(place.path, 'r');
  let bytes = 0;
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let count = readSync(file, chunk); count > 0; count = readSync(file, chunk)) {
      bytes += count;
      hash.update(chunk.subarray(0, count));
    }
  } finally {
    closeSync(file);
  }
  if (bytes !== original.bytes || hash.digest('hex') !== original.sha256)
    throw new Error('A required original is damaged.');
  return place.path;
}
/** Startup only, before the library opens; optional media is never removed by this originals-only merge. */
export function mergeOriginalSetSync(from: string, into: string, set: OriginalBackupSet): void {
  for (const original of set.files) {
    const source = verifiedSync(from, original);
    const target = folder(into, original);
    if (existsSync(target)) {
      verifiedSync(into, original);
      continue;
    }
    const partial = join(dirname(target), `.original-${randomUUID()}.part`);
    try {
      copyFileSync(source, partial);
      try {
        linkSync(partial, target);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      verifiedSync(into, original);
    } finally {
      rmSync(partial, { force: true });
    }
  }
}
