import { randomUUID, createHash } from 'node:crypto';
import type { MediaMarkers } from '../../shared/markers';
import { constants, createReadStream, statfsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { formatBytes } from '../../shared/format';
import type { ImportIssue } from '../../shared/import';
import type { ImportSource } from '../../shared/library';
import type { Db } from '../db/database';
import type { MediaKind } from './scan';
import { fileNameOf } from './media-resolver';
import type { MediaProbe } from './probe';
import { probeMedia } from './probe';
import { extOf, mediaKindOf } from './scan';

/*
 * Drashti's media folder. Every file is stored once, under its sha256
 * (<folder>/ab/abcdef....mp4), whatever it was called and however often it
 * is imported. The library keeps the original name and where it came from.
 */

export interface MediaStoreOptions {
  /** The media folder (userData/Media). */
  dir: string;
  /** Free bytes on the disk holding `dir` (tests pass their own). */
  freeBytes?: (dir: string) => number;
  /** Space always left free on that disk, so the show never runs out. Default 2 GiB. */
  reserveBytes?: number;
}

export type MediaImportResult =
  | {
      outcome: 'imported' | 'skipped';
      mediaId: string;
      sha256: string;
      bytes: number;
      name: string;
      /** What the file really is, and whether it plays. */
      probe: MediaProbe;
    }
  | { outcome: 'failed'; issue: ImportIssue };

/** Where a media item came from: pictures drawn from a document are Drashti's own ('drashti'). */
type MediaSource = { kind: Exclude<ImportSource['kind'], 'pictures'> } & {
  path: string;
  ref?: string | null;
};

/** A file whose bytes are in the media folder, before it has a library row. */
export interface StagedMedia {
  kind: MediaKind;
  name: string;
  /** Path inside the media folder. */
  rel: string;
  sha256: string;
  bytes: number;
  /** What it really is, and whether Drashti can play it. */
  probe: MediaProbe;
}

const GiB = 1024 ** 3;

/** In the media folder: the part-files of conversions going on (src/main/convert), not library content. */
export const CONVERTING_DIR = '.converting';

/** The media.playable column: 1, 0, or NULL when not sure. */
const playableValue = (probe: MediaProbe): number | null =>
  probe.playable === null ? null : probe.playable ? 1 : 0;

export function diskFreeBytes(dir: string): number {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

export async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
    const buf = chunk as Buffer;
    hash.update(buf);
    bytes += buf.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

export class MediaStore {
  private readonly freeBytes: (dir: string) => number;
  private readonly reserve: number;

  constructor(
    private readonly db: Db,
    private readonly options: MediaStoreOptions,
  ) {
    this.freeBytes = options.freeBytes ?? diskFreeBytes;
    this.reserve = options.reserveBytes ?? 2 * GiB;
  }

  get dir(): string {
    return this.options.dir;
  }

  /** Where a stored file lives, relative to the media folder. */
  static storedPath(sha256: string, ext: string): string {
    return `${sha256.slice(0, 2)}/${sha256}${ext ? `.${ext}` : ''}`;
  }

  private bySha(sha256: string): { id: string; name: string } | undefined {
    return this.db.prepare('SELECT id, name FROM media WHERE sha256 = ?').get(sha256) as
      { id: string; name: string } | undefined;
  }

  /**
   * Put a file's bytes into the media folder (once per sha256), checking
   * free space first. Never touches the original. No library rows (see
   * addStaged), so it never runs inside a group of database writes.
   */
  async stage(path: string): Promise<{ ok: true; staged: StagedMedia } | { ok: false; issue: ImportIssue }> {
    const kind = mediaKindOf(path);
    const name = basename(path);
    if (!kind) {
      return {
        ok: false,
        issue: {
          severity: 'error',
          code: 'not-media',
          message: `${name} is not a media file Drashti knows.`,
          fix: null,
        },
      };
    }
    let hashed: { sha256: string; bytes: number };
    try {
      hashed = await sha256File(path);
    } catch (error) {
      return {
        ok: false,
        issue: {
          severity: 'error',
          code: 'unreadable',
          message: `Could not read ${name}: ${(error as Error).message}`,
          fix: { kind: 'import-again', sourcePath: path },
        },
      };
    }
    const rel = MediaStore.storedPath(hashed.sha256, extOf(path));
    const target = join(this.dir, rel);
    const already = await stat(target).then(
      (s) => s.size === hashed.bytes,
      () => false,
    );
    if (!already) {
      const free = this.freeBytes(this.dir);
      if (hashed.bytes + this.reserve > free) {
        return {
          ok: false,
          issue: {
            severity: 'error',
            code: 'no-space',
            message: `Not enough free disk space to copy ${name} (${formatBytes(hashed.bytes)}). Drashti keeps ${formatBytes(this.reserve)} free for the show.`,
            fix: { kind: 'free-space', neededBytes: hashed.bytes + this.reserve - free },
          },
        };
      }
      const partial = `${target}.part-${randomUUID()}`;
      try {
        await mkdir(join(this.dir, hashed.sha256.slice(0, 2)), { recursive: true });
        // A copy-on-write clone where the disk supports it (APFS), else a normal copy.
        await copyFile(path, partial, constants.COPYFILE_FICLONE);
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true }).catch(() => undefined);
        return {
          ok: false,
          issue: {
            severity: 'error',
            code: 'copy-failed',
            message: `Could not copy ${name} into the media folder: ${(error as Error).message}`,
            fix: { kind: 'import-again', sourcePath: path },
          },
        };
      }
    }
    const probe = await probeMedia(target);
    return { ok: true, staged: { kind, name, rel, ...hashed, probe } };
  }

  /**
   * Import a media file: copy it into the media folder, unless the same
   * bytes are in the library already (then that item is returned, 'skipped').
   */
  async importFile(path: string, source: MediaSource): Promise<MediaImportResult> {
    const stage = await this.stage(path);
    if (!stage.ok) return { outcome: 'failed', issue: stage.issue };
    return this.addStaged(stage.staged, source);
  }

  /**
   * The library row for staged bytes: the item that already has them
   * ('skipped'), or a new one ('imported'). Only database work, so it can run
   * inside a group of writes.
   */
  addStaged(staged: StagedMedia, source: MediaSource): Extract<MediaImportResult, { mediaId: string }> {
    const existing = this.bySha(staged.sha256);
    if (existing) {
      // Imported before playability was known: record it now.
      this.db
        .prepare('UPDATE media SET playable = ?, format = ? WHERE id = ? AND playable IS NULL')
        .run(playableValue(staged.probe), staged.probe.format, existing.id);
      return {
        outcome: 'skipped',
        mediaId: existing.id,
        sha256: staged.sha256,
        bytes: staged.bytes,
        name: existing.name,
        probe: staged.probe,
      };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO media (id, kind, name, path, sha256, bytes, playable, format, source_kind, source_path, source_ref, source_imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        staged.kind,
        staged.name,
        staged.rel,
        staged.sha256,
        staged.bytes,
        playableValue(staged.probe),
        staged.probe.format,
        source.kind,
        source.path,
        source.ref ?? null,
        new Date().toISOString(),
      );
    return {
      outcome: 'imported',
      mediaId: id,
      sha256: staged.sha256,
      bytes: staged.bytes,
      name: staged.name,
      probe: staged.probe,
    };
  }

  /**
   * A media item whose file was not found: kept (path '') so slides can
   * point at it and the operator can relink it later. One per original path.
   */
  /** Start and end points and markers from an imported file (Session 14), unless the item has its own. */
  keepMarkers(mediaId: string, markers: MediaMarkers): boolean {
    return (
      this.db
        .prepare(
          "UPDATE media SET markers = ? WHERE id = ? AND markers IS NULL AND kind IN ('video', 'audio')",
        )
        .run(JSON.stringify(markers), mediaId).changes > 0
    );
  }

  addMissing(originalPath: string, kind: MediaKind, source: MediaSource): string {
    const found = this.db
      .prepare('SELECT id FROM media WHERE missing = 1 AND source_path = ? AND source_kind = ?')
      .get(originalPath, source.kind) as { id: string } | undefined;
    if (found) return found.id;
    const id = randomUUID();
    const name = fileNameOf(originalPath) || originalPath;
    this.db
      .prepare(
        `INSERT INTO media (id, kind, name, path, missing, source_kind, source_path, source_ref, source_imported_at)
         VALUES (?, ?, ?, '', 1, ?, ?, ?, ?)`,
      )
      .run(id, kind, name, source.kind, originalPath, source.ref ?? null, new Date().toISOString());
    return id;
  }

  /** Media items still waiting for their file. */
  missing(): { id: string; name: string; kind: MediaKind; originalPath: string | null }[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, kind, source_path FROM media WHERE missing = 1 ORDER BY name COLLATE NOCASE',
        )
        .all() as { id: string; name: string; kind: MediaKind; source_path: string | null }[]
    ).map((r) => ({ id: r.id, name: r.name, kind: r.kind, originalPath: r.source_path }));
  }

  /**
   * Fill in a missing media item from a file found later; the item keeps its
   * id. When those bytes are already stored under another item, the missing
   * one is merged into it: `repoint` moves any references, and the other
   * item's id is returned.
   */
  async fillMissing(
    mediaId: string,
    path: string,
    repoint: (fromId: string, toId: string) => void = () => undefined,
  ): Promise<MediaImportResult> {
    const row = this.db.prepare('SELECT id FROM media WHERE id = ? AND missing = 1').get(mediaId);
    if (!row) {
      return {
        outcome: 'failed',
        issue: {
          severity: 'error',
          code: 'not-missing',
          message: 'That media item is not missing.',
          fix: null,
        },
      };
    }
    const stage = await this.stage(path);
    if (!stage.ok) return { outcome: 'failed', issue: stage.issue };
    const stored = stage.staged;
    const existing = this.bySha(stored.sha256);
    if (existing) {
      this.db.transaction(() => {
        repoint(mediaId, existing.id);
        this.db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
      })();
      return {
        outcome: 'skipped',
        mediaId: existing.id,
        sha256: stored.sha256,
        bytes: stored.bytes,
        name: existing.name,
        probe: stored.probe,
      };
    }
    this.db
      .prepare(
        "UPDATE media SET path = ?, sha256 = ?, bytes = ?, missing = 0, playable = ?, format = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
      .run(
        stored.rel,
        stored.sha256,
        stored.bytes,
        playableValue(stored.probe),
        stored.probe.format,
        mediaId,
      );
    return {
      outcome: 'imported',
      mediaId,
      sha256: stored.sha256,
      bytes: stored.bytes,
      name: stored.name,
      probe: stored.probe,
    };
  }
}
