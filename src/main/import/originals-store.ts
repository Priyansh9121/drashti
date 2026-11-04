import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { PictureSource } from '../../shared/pictures';
import type { Db } from '../db/database';
import { realPlaceAsync } from '../media/contained';
import { fileProblem } from '../plain-errors';
import { diskFreeBytes, sha256File } from './media-store';

/** Immutable received document bytes, distinct from the pictures/media made from them. */
export interface OriginalDescriptor {
  sha256: string;
  ext: PictureSource;
  bytes: number;
}
export const ORIGINALS_DIR = 'Originals';
export const ORIGINALS_STAGING_DIR = '.originals-staging';
const EXTENSIONS: readonly string[] = ['pdf', 'pptx', 'ppt', 'key'];
export function validOriginal(value: OriginalDescriptor): boolean {
  return (
    /^[0-9a-f]{64}$/u.test(value.sha256) &&
    EXTENSIONS.includes(value.ext) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= 1024 ** 3
  );
}
const hashPrefix = (hash: string): string => {
  const prefix = /^[0-9a-f]{2}/u.exec(hash)?.[0];
  if (!prefix) throw new Error('The original digest is not valid.');
  return prefix;
};
export function originalRelative(value: OriginalDescriptor): string {
  if (!validOriginal(value)) throw new Error('The original document reference is not valid.');
  return join(ORIGINALS_DIR, hashPrefix(value.sha256), `${value.sha256}.${value.ext}`);
}
export function retainedOriginals(db: Db): OriginalDescriptor[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'document_originals'").get())
    return [];
  const rows = db
    .prepare('SELECT sha256, ext, bytes FROM document_originals ORDER BY sha256, ext')
    .all() as OriginalDescriptor[];
  if (!rows.every(validOriginal)) throw new Error('The retained original document registry is not valid.');
  return rows;
}
/** Scheduled callers gate and account for checksum IO as well as the bytes they copy. */
export type OriginalReadGuard = (bytes: number) => Promise<void>;
async function guardedChecksum(
  file: string,
  guard: OriginalReadGuard,
): Promise<{ sha256: string; bytes: number }> {
  await guard(0);
  const input = await open(file, 'r');
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(256 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      // Explicit reads avoid a stream prefetching the rest of an original while the show has paused this job.
      await guard(0);
      const read = await input.read(chunk, 0, chunk.length, bytes);
      if (read.bytesRead === 0) break;
      await guard(read.bytesRead);
      hash.update(chunk.subarray(0, read.bytesRead));
      bytes += read.bytesRead;
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    await input.close();
  }
}
export async function verifiedOriginal(
  mediaDir: string,
  original: OriginalDescriptor,
  guard?: OriginalReadGuard,
): Promise<string | null> {
  if (!validOriginal(original)) return null;
  if (guard) await guard(0);
  const place = await realPlaceAsync(mediaDir, join(mediaDir, originalRelative(original)));
  if (!place?.inside) return null;
  const guardState = { failed: false };
  try {
    const info = await stat(place.path);
    if (!info.isFile() || info.size !== original.bytes) return null;
    const hashed = guard
      ? await guardedChecksum(place.path, async (bytes) => {
          try {
            await guard(bytes);
          } catch (error) {
            guardState.failed = true;
            throw error;
          }
        })
      : await sha256File(place.path);
    return hashed.sha256 === original.sha256 && hashed.bytes === original.bytes ? place.path : null;
  } catch (error) {
    if (guardState.failed) throw error;
    return null;
  }
}
interface Options {
  freeBytes?: (dir: string) => number;
  reserveBytes?: number;
}
export type StageOriginal =
  { ok: true; original: OriginalDescriptor; file: string } | { ok: false; message: string };

export class OriginalsStore {
  constructor(
    private readonly db: Db,
    readonly mediaDir: string,
    private readonly options: Options = {},
  ) {}

  list(): OriginalDescriptor[] {
    return retainedOriginals(this.db);
  }

  register(original: OriginalDescriptor, sourcePath?: string): void {
    if (sourcePath !== undefined && (!isAbsolute(sourcePath) || sourcePath.includes('\0')))
      throw new Error('An original source location must be an absolute file path.');
    if (!validOriginal(original)) throw new Error('The original document reference is not valid.');
    const existing = this.db
      .prepare('SELECT bytes FROM document_originals WHERE sha256 = ? AND ext = ?')
      .get(original.sha256, original.ext) as { bytes: number } | undefined;
    if (existing && existing.bytes !== original.bytes)
      throw new Error('The retained original record disagrees with its bytes.');
    this.db
      .prepare('INSERT OR IGNORE INTO document_originals (sha256, ext, bytes) VALUES (?, ?, ?)')
      .run(original.sha256, original.ext, original.bytes);
    if (sourcePath !== undefined)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO document_original_locations (sha256, ext, source_path) VALUES (?, ?, ?)',
        )
        .run(original.sha256, original.ext, sourcePath);
  }

  sourceLocations(): string[] {
    if (
      !this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'document_original_locations'")
        .get()
    )
      return [];
    return (
      this.db
        .prepare('SELECT DISTINCT source_path FROM document_original_locations ORDER BY source_path')
        .all() as { source_path: string }[]
    )
      .map((row) => row.source_path)
      .filter(isAbsolute);
  }

  registerPreview(original: OriginalDescriptor, mediaId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO document_original_previews (sha256, ext, media_id) VALUES (?, ?, ?)')
      .run(original.sha256, original.ext, mediaId);
  }

  resolve(original: OriginalDescriptor): Promise<string | null> {
    return verifiedOriginal(this.mediaDir, original);
  }

  async stage(path: string, ext: PictureSource, signal?: AbortSignal): Promise<StageOriginal> {
    let partial: string | null = null;
    try {
      if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
      const before = await stat(path);
      const limit = ext === 'pdf' ? 500 * 1024 ** 2 : 1024 ** 3;
      if (!before.isFile() || before.size <= 0 || before.size > limit || !EXTENSIONS.includes(ext))
        return {
          ok: false,
          message:
            'This document is empty, too large, or is not a regular document file. Save a smaller, single-file PDF or deck, then import that copy.',
        };
      await mkdir(this.mediaDir, { recursive: true });
      const free = (this.options.freeBytes ?? diskFreeBytes)(this.mediaDir);
      if (before.size + (this.options.reserveBytes ?? 2 * 1024 ** 3) > free)
        return { ok: false, message: 'There is not enough free space to retain this document safely.' };
      const staging = join(this.mediaDir, ORIGINALS_STAGING_DIR);
      await mkdir(staging, { recursive: true });
      if (!(await realPlaceAsync(this.mediaDir, staging))?.inside)
        return { ok: false, message: 'The original document staging folder is outside the library.' };
      partial = join(staging, randomUUID());
      await pipeline(createReadStream(path), createWriteStream(partial, { flags: 'wx', mode: 0o600 }), {
        signal,
      });
      const after = await stat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino)
        return { ok: false, message: 'The document changed while it was being copied: import it again.' };
      const hashed = await sha256File(partial);
      const original: OriginalDescriptor = { ...hashed, ext };
      if (!validOriginal(original) || hashed.bytes !== before.size)
        return {
          ok: false,
          message: 'The document could not be copied whole. Check free disk space and import it again.',
        };
      if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
      const folder = join(this.mediaDir, ORIGINALS_DIR, hashPrefix(original.sha256));
      const originalsDir = join(this.mediaDir, ORIGINALS_DIR);
      await mkdir(originalsDir, { recursive: true });
      if (!(await realPlaceAsync(this.mediaDir, originalsDir))?.inside)
        return { ok: false, message: 'The retained original folder is outside the library.' };
      await mkdir(folder, { recursive: true });
      if (!(await realPlaceAsync(this.mediaDir, folder))?.inside)
        return { ok: false, message: 'The retained original folder is outside the library.' };
      const target = join(this.mediaDir, originalRelative(original));
      try {
        // Exclusive atomic publication: an existing immutable file is never replaced, even by identical input.
        await link(partial, target);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      const file = await this.resolve(original);
      if (!file)
        return {
          ok: false,
          message: 'The retained original is damaged: it was left unchanged. Restore it from a backup.',
        };
      if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
      return { ok: true, original, file };
    } catch (error) {
      return {
        ok: false,
        message: signal?.aborted
          ? 'Cancelled.'
          : `The original document could not be retained. ${fileProblem(error, 'own')}`,
      };
    } finally {
      if (partial) await rm(partial, { force: true }).catch(() => undefined);
    }
  }
}
