import {
  createReadStream,
  createWriteStream,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { LIBRARY_BUSY_TIMEOUT_MS, type Db } from '../db/database';
import { isBusy } from '../db/later-writes';
import { mediaInUse } from '../library/media-uses';
import { isTaken } from '../library/media-taken';
import { removeDerived } from '../library/media-removal';
import { MediaStore } from '../import/media-store';
import { hashOffMain } from '../library/hash-off-main';
import { KEEP_FREE_BYTES } from './convert-service';
import { hasAlpha, type MediaInfo } from './plan';

/** Small private request manifests, atomic and outside Git. No local path reaches an output renderer. */
export function copyRequests(file: string): { load(): unknown; save(value: unknown): void } {
  return {
    load: () => {
      try {
        if (statSync(file).size > 8 * 1024 ** 2) return null;
        return JSON.parse(readFileSync(file, 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    save: (value) => {
      const temporary = `${file}.part`;
      writeFileSync(temporary, JSON.stringify(value));
      renameSync(temporary, file);
    },
  };
}

/** Register only validated output; hashing and copying can both stop as soon as activity starts. */
export async function registerProxyFile(options: {
  db: Db;
  mediaDir: string;
  file: string;
  info: MediaInfo;
  name?: string;
  idle(): boolean;
  freeBytes(dir: string): number;
  signal: AbortSignal;
  /**
   * Whether a file it renamed into Media with no row made of it may be removed now (a22-review-combine2 R-S1): not
   * while an import goes, which may have seen that very file and write its own row for it later. Left out: it may.
   */
  mayRemove?(): boolean;
}): Promise<string> {
  const { db, mediaDir, file, info, signal } = options;
  signal.throwIfAborted();
  const hashed = await hashOffMain(file, signal);
  const ext = hasAlpha(info) || info.container === 'matroska,webm' ? 'webm' : 'mp4';
  const relative = MediaStore.storedPath(hashed.sha256, ext);
  const destination = join(mediaDir, relative);
  const part = `${destination}.part-${randomUUID()}`;
  const control = new AbortController();
  const guard = () => {
    if (!options.idle() || options.freeBytes(mediaDir) < KEEP_FREE_BYTES) control.abort();
  };
  const combined = AbortSignal.any([signal, control.signal]);
  const timer = setInterval(guard, 1000);
  timer.unref();
  // The file this call put into Media, until a row keeps it (a22-review-combine2 S1).
  const own = { renamed: false, kept: false };
  try {
    guard();
    combined.throwIfAborted();
    const existing = await stat(destination).then(
      (entry) => entry.size === hashed.bytes,
      () => false,
    );
    if (!existing) {
      if (options.freeBytes(mediaDir) - hashed.bytes < KEEP_FREE_BYTES)
        throw new Error('Insufficient copy space.');
      await mkdir(dirname(destination), { recursive: true });
      await pipeline(
        createReadStream(file, { highWaterMark: 256 * 1024 }),
        createWriteStream(part, { flags: 'wx' }),
        { signal: combined },
      );
      guard();
      combined.throwIfAborted();
      await rename(part, destination);
      own.renamed = true;
    }
    const store = new MediaStore(db, { dir: mediaDir });
    const until = Date.now() + 30_000;
    for (;;) {
      guard();
      combined.throwIfAborted();
      const previous = db.pragma('busy_timeout', { simple: true }) as number;
      try {
        db.pragma('busy_timeout = 0');
        const mediaId = db
          .transaction(
            () =>
              store.addStaged(
                {
                  kind: 'video',
                  name: options.name ?? '1080p playing copy',
                  rel: relative,
                  sha256: hashed.sha256,
                  bytes: hashed.bytes,
                  durationMs: info.durationMs ?? undefined,
                  probe: {
                    kind: 'video',
                    playable: true,
                    format: hasAlpha(info)
                      ? 'VP9 video with transparency (WebM)'
                      : info.video?.codec === 'vp9'
                        ? 'VP9 video (WebM)'
                        : 'H.264 video (MP4)',
                  },
                  readBy: 'ffmpeg',
                },
                { kind: 'drashti', path: file },
              ).mediaId,
          )
          .immediate();
        own.kept = true;
        return mediaId;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'SQLITE_BUSY' ||
          Date.now() >= until
        )
          throw error;
      } finally {
        db.pragma(`busy_timeout = ${String(previous)}`);
      }
      await delay(25, undefined, { signal: combined });
    }
  } finally {
    clearInterval(timer);
    // Stopped, held or refused after its rename into Media and before its row: nothing would ever find that file again.
    // It goes in this same turn, unless a row keeps that path (an import of the same bytes, say): then it stays.
    if (own.renamed && !own.kept)
      try {
        if (
          options.mayRemove?.() !== false &&
          !db.prepare('SELECT 1 FROM media WHERE path = ? LIMIT 1').get(relative)
        )
          rmSync(destination, { force: true });
      } catch {
        /* Held (Windows) or the library closing: left, as before. */
      }
    await rm(part, { force: true }).catch(() => undefined);
  }
}

/** A copy into Media that registerProxyFile made and nobody listed: unlisted, Drashti's own, not deleted, a video. */
const UNLISTED = "listed = 0 AND deleted_at IS NULL AND source_kind = 'drashti' AND kind = 'video'";

/**
 * How many such copies made from `file` (a work or temporary file) are still in Media: after discardUnlisted, the ones
 * kept only for now (a file still held, a row taken up in this run) or used (a22-review-combine2 L-E1).
 */
export function unlistedMadeFrom(db: Db, file: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM media WHERE ${UNLISTED} AND source_path = ?`).get(file) as {
      n: number;
    }
  ).n;
}

/**
 * Combine videos… (a22-review-combine S4): the rows registerProxyFile made from `file` (one combine's work file) and
 * that were never listed, removed with their files in Media, so a combine failing late leaves nothing behind. With
 * `folder`, every such row made from a file in that folder (what a quit or a crash left, found at the next start), or
 * made with the library at another place (moved, or its folders spelled otherwise: a22-combineleaks N6) from a file of
 * the exact form a work file there has (`<that folder's name>/.<uuid>.mp4`). With `files`, the rows made from any of
 * them, in one pass (one library-wide scan).
 * The rows are chosen at the call, so a combine started afterwards is never touched; only rows made from that work
 * file: a video already in Media with the same bytes keeps its own source, and a row listed meanwhile (imported again)
 * stays. `keep` (the row just listed) stays.
 * When in doubt it keeps (a22-review-combine2):
 * - a row anything uses stays, with its file: an import can take a row up by its bytes without listing it (a deck's
 *   video kept as an editable document object, a kirtan bundle's link, Edit Video's copy), and running orders,
 *   wallpapers, slides and settings may then name it (library/media-uses.ts, the Trim cleanup's own checks);
 * - a row taken up by its bytes in this run stays for the rest of it, as whoever took it may name it only later (a
 *   deck's editor on Save, an edit's record: library/media-taken.ts); the next start's sweep may remove it if unused;
 * - a row goes only with its file: a file that cannot be removed (held open on Windows) keeps its row, so the next
 *   start finds it again; a file another row keeps stays;
 * - a row whose file is not inside Media's folder stays;
 * - nothing goes unless `allowed` says so, asked before it starts, each time it looks again and in the very turn it
 *   removes (a22-review-combine2 R-S1, R-S2: no import going, which can reuse a file or a row in two steps without the
 *   lock, and nothing playing, on air or recording, as its library-wide scan runs on Main); `keep` (the rows live jobs
 *   hold) stays.
 * A removed row's derived copies (its still frame, sharpened, blurred and display copies, kept by sha256) go too, once
 * no row has that sha256 (a22-combineleaks N2).
 * It never waits on the library's write lock (an import holding it): it looks again shortly, as registerProxyFile
 * does. How many rows went, or null when `allowed` stopped it (nothing removed: left for later).
 */
export async function discardUnlisted(options: {
  db: Db;
  mediaDir: string;
  file?: string;
  folder?: string;
  files?: readonly string[];
  keep?: string | null | ReadonlySet<string>;
  allowed?(): boolean;
}): Promise<number | null> {
  const { db } = options;
  const allowed = () => options.allowed?.() ?? true;
  const kept = (id: string) =>
    typeof options.keep === 'string' ? id === options.keep : (options.keep?.has(id) ?? false);
  const unlisted = UNLISTED;
  const found = chosen(db, unlisted, options);
  const ids = found.map((row) => row.id).filter((id) => !kept(id));
  if (ids.length === 0) return 0;
  if (!allowed()) return null;
  const media = resolve(options.mediaDir);
  const until = Date.now() + 30_000;
  for (;;) {
    if (!allowed()) return null;
    let done: { removed: number; shas: string[] } | null;
    try {
      done = withoutWaiting(db, () =>
        db
          .transaction((): { removed: number; shas: string[] } | null => {
            // Asked again under the lock, in the very turn it removes.
            if (!allowed()) return null;
            const rows = ids.flatMap(
              (id) =>
                (db.prepare(`SELECT id, path, sha256 FROM media WHERE id = ? AND ${unlisted}`).get(id) as
                  { id: string; path: string; sha256: string | null } | undefined) ?? [],
            );
            const used = mediaInUse(db, options.mediaDir, rows);
            // Edit Video's records of its copies (references without a cascade).
            const edited = db.prepare(
              `SELECT 1 FROM video_edit_copies WHERE source_id = @id OR copy_id = @id
             UNION ALL SELECT 1 FROM media WHERE video_edit_copy_id = @id LIMIT 1`,
            );
            const keeps = db.prepare('SELECT 1 FROM media WHERE path = ? LIMIT 1');
            const shared = db.prepare('SELECT 1 FROM media WHERE sha256 = ? LIMIT 1');
            let removed = 0;
            const shas: string[] = [];
            for (const row of rows) {
              const file = resolve(media, row.path);
              if (row.path === '' || !file.startsWith(`${media}${sep}`)) continue;
              // Taken up by its bytes in this run (MediaStore handed it back): perhaps named only later (L-S1).
              if (used.has(row.id) || isTaken(row.id) || edited.get({ id: row.id }) !== undefined) continue;
              try {
                // The row and its file together: a file that cannot be removed puts its row back (a savepoint).
                db.transaction(() => {
                  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
                  if (!keeps.get(row.path)) rmSync(file, { force: true });
                })();
              } catch (error) {
                if (isBusy(error)) throw error;
                continue;
              }
              removed += 1;
              if (row.sha256 && !shared.get(row.sha256)) shas.push(row.sha256);
            }
            return { removed, shas };
          })
          .immediate(),
      );
    } catch (error) {
      if (!isBusy(error) || Date.now() >= until) throw error;
      await delay(25);
      continue;
    }
    if (done === null) return null;
    // Its still frame and copies, regenerable, by sha256 (no row has it now); only while still allowed, and with Main's
    // usual wait for the write lock back already (a22-review-combine2 MUST-C1).
    for (const sha of done.shas)
      if (allowed()) await removeDerived(options.mediaDir, sha).catch(() => undefined);
    return done.removed;
  }
}

/**
 * `run` (synchronous: never an await inside) with Main's wait for the library's write lock set to 0, so an import
 * holding the lock makes it fail at once instead of holding Main up to 5 s; the wait is put back in the same turn.
 * As nothing else can run in between, two removals cannot interleave here; and a wait read as 0 (left so by anything
 * else) is put back as the library's own, never left at 0 (a22-review-combine2 MUST-C1).
 */
function withoutWaiting<T>(db: Db, run: () => T): T {
  const previous = db.pragma('busy_timeout', { simple: true }) as number;
  db.pragma('busy_timeout = 0');
  try {
    return run();
  } finally {
    db.pragma(`busy_timeout = ${String(previous > 0 ? previous : LIBRARY_BUSY_TIMEOUT_MS)}`);
  }
}

/** The rows a discardUnlisted call may remove, chosen at the call (a file, a folder or several files). */
function chosen(
  db: Db,
  unlisted: string,
  options: { file?: string; folder?: string; files?: readonly string[] },
): { id: string }[] {
  if (options.files !== undefined)
    return db
      .prepare(`SELECT id FROM media WHERE ${unlisted} AND source_path IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(options.files)) as { id: string }[];
  if (options.folder === undefined)
    return db
      .prepare(`SELECT id FROM media WHERE ${unlisted} AND source_path = ?`)
      .all(options.file ?? '') as {
      id: string;
    }[];
  const folder = options.folder.replace(/[\\/]+$/u, '');
  const within = `${folder}${sep}`;
  const name = basename(folder);
  // A work file as the convert service names it: `.<uuid>.mp4`, in a folder of that very name, at any place.
  const moved = new RegExp(
    `(?:^|[\\\\/])${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\\\/]\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.mp4$`,
    'u',
  );
  return (
    db
      .prepare(
        `SELECT id, source_path AS source FROM media WHERE ${unlisted}
           AND (substr(source_path, 1, length(?)) = ? OR instr(source_path, ?) > 0)`,
      )
      .all(within, within, name) as { id: string; source: string }[]
  ).filter((row) => row.source.startsWith(within) || (name !== '' && moved.test(row.source)));
}
