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
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Db } from '../db/database';
import { isBusy } from '../db/later-writes';
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
    }
    const store = new MediaStore(db, { dir: mediaDir });
    const until = Date.now() + 30_000;
    for (;;) {
      guard();
      combined.throwIfAborted();
      const previous = db.pragma('busy_timeout', { simple: true }) as number;
      try {
        db.pragma('busy_timeout = 0');
        return db
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
    await rm(part, { force: true }).catch(() => undefined);
  }
}

/**
 * Combine videos… (a22-review-combine S4): the rows registerProxyFile made from `file` (one combine's work file) and
 * that were never listed, removed with their files in Media, so a combine failing late leaves nothing behind. With
 * `folder`, every such row made from a file in that folder (what a quit or a crash left, found at the next start).
 * The rows are chosen at the call, so a combine started afterwards is never touched; only rows made from that work
 * file: a video already in Media with the same bytes keeps its own source, and a row listed meanwhile (imported again)
 * stays. `keep` (the row just listed) stays, and so does a file another row still keeps. It never waits on the
 * library's write lock (an import holding it): it looks again shortly, as registerProxyFile does. How many rows went.
 */
export async function discardUnlisted(options: {
  db: Db;
  mediaDir: string;
  file?: string;
  folder?: string;
  keep?: string | null;
}): Promise<number> {
  const { db } = options;
  const unlisted = "listed = 0 AND deleted_at IS NULL AND source_kind = 'drashti' AND kind = 'video'";
  const within = options.folder === undefined ? null : `${options.folder.replace(/[\\/]+$/u, '')}${sep}`;
  const found = (
    within === null
      ? db.prepare(`SELECT id FROM media WHERE ${unlisted} AND source_path = ?`).all(options.file ?? '')
      : db
          .prepare(`SELECT id FROM media WHERE ${unlisted} AND substr(source_path, 1, length(?)) = ?`)
          .all(within, within)
  ) as { id: string }[];
  const ids = found.map((row) => row.id).filter((id) => id !== options.keep);
  if (ids.length === 0) return 0;
  const media = resolve(options.mediaDir);
  const until = Date.now() + 30_000;
  for (;;) {
    const previous = db.pragma('busy_timeout', { simple: true }) as number;
    try {
      db.pragma('busy_timeout = 0');
      const { removed, files } = db
        .transaction(() => {
          const gone: string[] = [];
          for (const id of ids) {
            const row = db.prepare(`SELECT path FROM media WHERE id = ? AND ${unlisted}`).get(id) as
              { path: string } | undefined;
            if (!row) continue;
            try {
              db.prepare('DELETE FROM media WHERE id = ?').run(id);
            } catch (error) {
              // Something now points at it (a reference kept without a cascade): left as it is.
              if (isBusy(error)) throw error;
              continue;
            }
            gone.push(row.path);
          }
          // A file goes only when no row keeps it any more, and only inside Media's own folder.
          return {
            removed: gone.length,
            files: gone.filter(
              (path) => path !== '' && !db.prepare('SELECT 1 FROM media WHERE path = ? LIMIT 1').get(path),
            ),
          };
        })
        .immediate();
      for (const path of files) {
        const file = resolve(media, path);
        if (!file.startsWith(`${media}${sep}`)) continue;
        try {
          rmSync(file, { force: true });
        } catch {
          /* A file held open (Windows) stays; its row is gone, so nothing lists or plays it. */
        }
      }
      return removed;
    } catch (error) {
      if (!isBusy(error) || Date.now() >= until) throw error;
    } finally {
      db.pragma(`busy_timeout = ${String(previous)}`);
    }
    await delay(25);
  }
}
