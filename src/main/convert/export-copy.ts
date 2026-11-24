import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ExportCopyResult } from '../../shared/video-copies';
import { KEEP_FREE_BYTES } from './convert-service';

/*
 * Export… (alpha.22; the owner, 24 Nov 2026: "export button as well to download"): a video Drashti made (a combined
 * video; a22-save-trim's trimmed one may use it too) copied, byte for byte, to a file the operator chooses in the
 * system's own save dialog, offered in Downloads under the video's name. Nothing is encoded again. A file already
 * there is replaced only when the system's dialog asked first (macOS and Windows both ask); the copy is written beside
 * it and renamed over it only when whole, so it lands whole or not at all. Never while anything is up, streaming or
 * recording: the copy stops at once if one starts, and nothing is left of it.
 */
export interface ExportCopyOptions {
  /** The finished file (Media's own copy). */
  source: string;
  /** The name offered ("Opening + Talk.mp4"). */
  name: string;
  /** The folder offered first: this computer's Downloads. */
  downloads: string;
  /** The system's save dialog, opened at `defaultPath`: the file chosen, or null when cancelled. */
  pick(defaultPath: string): Promise<string | null>;
  /** Whether nothing is up, streaming or recording (asked before and throughout the copy). */
  idle(): boolean;
  freeBytes(dir: string): number;
}

/** Where the save dialog opens: Downloads, and the name with no character a file name cannot hold. */
export function exportOffer(downloads: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/gu, '_').trim() || 'Video.mp4';
  return join(downloads, safe);
}

const BUSY =
  'Export… waits for an idle moment: nothing can be exported while anything is up, streaming or recording. Try again when the show is idle.';

/** Copy `source` to `dest` (chosen in the system's dialog), whole or not at all, stopping if the show starts. */
export async function copyToChosen(
  source: string,
  dest: string,
  options: Pick<ExportCopyOptions, 'idle' | 'freeBytes'>,
): Promise<ExportCopyResult> {
  if (resolve(dest) === resolve(source))
    return { ok: false, message: 'Choose another place to save the copy: that is Drashti’s own file.' };
  if (!options.idle()) return { ok: false, message: BUSY };
  const size = statSync(source, { throwIfNoEntry: false })?.size;
  if (size === undefined)
    return { ok: false, message: 'The video’s file is missing from Media. Combine the videos again.' };
  const folder = dirname(dest);
  if (options.freeBytes(folder) - size < KEEP_FREE_BYTES)
    return {
      ok: false,
      message:
        'There is not enough free space there while keeping 2 GB free. Free up some space or choose another place, then Export again.',
    };
  const part = join(folder, `.${basename(dest)}.part-${randomUUID()}`);
  const control = new AbortController();
  const guard = setInterval(() => {
    if (!options.idle()) control.abort();
  }, 250);
  guard.unref();
  try {
    await pipeline(
      createReadStream(source, { highWaterMark: 256 * 1024 }),
      createWriteStream(part, { flags: 'wx' }),
      { signal: control.signal },
    );
    if (!options.idle()) throw new Error('The show started.');
    await rename(part, dest);
    return { ok: true, path: dest };
  } catch {
    return {
      ok: false,
      message:
        control.signal.aborted || !options.idle()
          ? 'The export stopped because the show, stream or recording started. Export again when it is idle.'
          : 'Drashti could not write the file there. Choose another folder, then Export again.',
    };
  } finally {
    clearInterval(guard);
    await rm(part, { force: true }).catch(() => undefined);
  }
}

/** Export…: the system's save dialog (Downloads, the video's name), then the copy. */
export async function exportCopy(options: ExportCopyOptions): Promise<ExportCopyResult> {
  if (!options.idle()) return { ok: false, message: BUSY };
  const dest = await options.pick(exportOffer(options.downloads, options.name));
  if (dest === null) return { ok: true, path: null };
  return copyToChosen(options.source, dest, options);
}
