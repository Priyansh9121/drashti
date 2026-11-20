import {
  createReadStream,
  createWriteStream,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Db } from '../db/database';
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
                      ? 'VP9 video with transparency (WebM), lighter playing copy'
                      : 'H.264 video (MP4), lighter playing copy',
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
