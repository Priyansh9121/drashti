import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db/database';
import { MediaStore } from '../import/media-store';
import { hashOffMain } from '../library/hash-off-main';
import type { SourceWrite } from '../documents/source-write';
import { KEEP_FREE_BYTES } from './convert-service';
import { hasAlpha, type MediaInfo } from './plan';

/** Only unpublished output is copied. A new hash-named, unlisted media item never replaces source bytes. */
export async function registerEditedFile(options: {
  db: Db;
  mediaDir: string;
  file: string;
  name: string;
  info: MediaInfo;
  signal: AbortSignal;
  idle(): boolean;
  freeBytes(dir: string): number;
  write: SourceWrite;
}): Promise<string> {
  const { signal, info, mediaDir } = options;
  signal.throwIfAborted();
  const hashed = await hashOffMain(options.file, signal);
  const relative = MediaStore.storedPath(hashed.sha256, hasAlpha(info) ? 'webm' : 'mp4');
  const destination = join(mediaDir, relative);
  const part = `${destination}.part-${randomUUID()}`;
  const control = new AbortController();
  const combined = AbortSignal.any([signal, control.signal]);
  const guard = () => {
    if (!options.idle() || options.freeBytes(mediaDir) - hashed.bytes < KEEP_FREE_BYTES) control.abort();
  };
  const timer = setInterval(guard, 250);
  timer.unref();
  try {
    guard();
    combined.throwIfAborted();
    await mkdir(dirname(destination), { recursive: true });
    await pipeline(
      createReadStream(options.file, { highWaterMark: 256 * 1024 }),
      createWriteStream(part, { flags: 'wx' }),
      { signal: combined },
    );
    guard();
    combined.throwIfAborted();
    await rename(part, destination);
    const store = new MediaStore(options.db, { dir: mediaDir });
    return await options.write({ signal: combined, allowed: options.idle }, () => {
      guard();
      combined.throwIfAborted();
      return store.addStaged(
        {
          kind: 'video',
          name: options.name,
          rel: relative,
          ...hashed,
          durationMs: info.durationMs ?? undefined,
          probe: {
            kind: 'video',
            playable: true,
            format: hasAlpha(info)
              ? 'VP9 video with transparency (WebM), edited copy'
              : 'H.264 video (MP4), edited copy',
          },
          readBy: 'ffmpeg',
        },
        { kind: 'drashti', path: relative },
      ).mediaId;
    });
  } finally {
    clearInterval(timer);
    await rm(part, { force: true });
  }
}
