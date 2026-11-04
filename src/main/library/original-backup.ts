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
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { copyFile, link, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { documentPageFromJson } from '../../shared/document-page';
import { cutText } from '../../shared/text';
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
/**
 * A retained original a backup left out (alpha.15): missing or damaged in the library when the backup was made,
 * with what the operator knows it by.
 */
export interface LeftOutOriginal extends OriginalDescriptor {
  name?: string;
}

/** The set without the originals left out of it; undefined when none is left. */
export function heldOriginals(
  set: OriginalBackupSet,
  leftOut: readonly OriginalDescriptor[],
): OriginalBackupSet | undefined {
  const files = set.files.filter(
    (original) => !leftOut.some((out) => out.sha256 === original.sha256 && out.ext === original.ext),
  );
  return files.length ? { version: 1, files } : undefined;
}

const NAME_MAX = 120;
/**
 * What the operator knows each original by (alpha.15): the presentation imported from it, else one whose pages
 * come from it, else the file it was inserted from. Read from a library file nothing else has open; a
 * library that cannot say leaves the names out (the words then say what kind of file it was).
 */
export function namedOriginals(dbFile: string, originals: readonly OriginalDescriptor[]): LeftOutOriginal[] {
  const plain = originals.map((original) => ({ ...original }));
  if (!originals.length) return plain;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
    const open = db;
    const first = (sql: string, ...params: string[]): string | undefined => {
      try {
        const value = open
          .prepare(sql)
          .pluck()
          .get(...params);
        return typeof value === 'string' && value.trim() ? value : undefined;
      } catch {
        return undefined;
      }
    };
    const pageOf = (original: OriginalDescriptor): string | undefined => {
      try {
        const rows = open
          .prepare(
            `SELECT p.name, s.document_page FROM presentations p JOIN slide_groups g ON g.presentation_id = p.id
               JOIN slides s ON s.group_id = g.id
              WHERE s.document_page LIKE ? ORDER BY p.deleted_at IS NOT NULL, p.name COLLATE NOCASE`,
          )
          .all(`%${original.sha256}%`) as { name: string; document_page: string }[];
        return rows.find((row) => {
          const page = documentPageFromJson(row.document_page);
          return page?.sha256 === original.sha256 && page.ext === original.ext;
        })?.name;
      } catch {
        return undefined;
      }
    };
    return plain.map((original) => {
      const name =
        first(
          'SELECT name FROM presentations WHERE source_hash = ? ORDER BY deleted_at IS NOT NULL, name COLLATE NOCASE',
          original.sha256,
        ) ??
        pageOf(original) ??
        // The file's own name, on either system (a library can come from the other one).
        first(
          'SELECT source_path FROM document_original_locations WHERE sha256 = ? AND ext = ? ORDER BY source_path',
          original.sha256,
          original.ext,
        )
          ?.split(/[\\/]/u)
          .at(-1);
      return name ? { ...original, name: cutText(name, NAME_MAX, '…') } : original;
    });
  } catch {
    return plain;
  } finally {
    db?.close();
  }
}

/**
 * Copy a set's originals, each verified, into a new backup's Media folder. One missing or damaged in `from`
 * (alpha.15) is left out, and the others are copied all the same. Returns those left out.
 */
export async function copyOriginalSet(
  from: string,
  into: string,
  set: OriginalBackupSet,
): Promise<OriginalDescriptor[]> {
  const leftOut: OriginalDescriptor[] = [];
  for (const original of set.files) {
    const source = await verifiedOriginal(from, original);
    if (!source) {
      leftOut.push(original);
      continue;
    }
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
  return leftOut;
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
/** The code of the error a merge throws when an original it must copy is missing or damaged where it is read. */
export const ORIGINAL_DAMAGED = 'EORIGINALDAMAGED';

/**
 * Startup only, before the library opens; optional media is never removed by this originals-only merge.
 * Every original in `from` must be whole, unless `leaveOutBad` (alpha.15: the current library's own, kept
 * before a restore): then one missing or damaged there is left out, and returned. A damaged copy already in
 * `into` stops the merge, unless `moveBadTo` (a restore over the current library): then it goes there, kept
 * for diagnosis, and the whole one takes its place.
 */
export function mergeOriginalSetSync(
  from: string,
  into: string,
  set: OriginalBackupSet,
  options: { leaveOutBad?: boolean; moveBadTo?: string } = {},
): OriginalDescriptor[] {
  const leftOut: OriginalDescriptor[] = [];
  for (const original of set.files) {
    let source: string;
    try {
      source = verifiedSync(from, original);
    } catch (error) {
      if (!options.leaveOutBad) {
        // A file that cannot be read keeps its own code (no permission, say); missing or damaged gets ours.
        if (error instanceof Error && 'code' in error) throw error;
        throw Object.assign(new Error('An original to copy is missing or damaged.'), {
          code: ORIGINAL_DAMAGED,
        });
      }
      leftOut.push(original);
      continue;
    }
    const target = folder(into, original);
    if (existsSync(target)) {
      try {
        verifiedSync(into, original);
        continue;
      } catch (error) {
        if (options.moveBadTo === undefined) throw error;
        mkdirSync(options.moveBadTo, { recursive: true });
        renameSync(target, join(options.moveBadTo, basename(target)));
      }
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
  return leftOut;
}
