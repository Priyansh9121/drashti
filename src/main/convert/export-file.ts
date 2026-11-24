import { constants } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ExportFileResult } from '../../shared/export-file';
import { freeFileName } from './trim';

/*
 * Export… (alpha.22, the owner: "export button as well to download"): a finished video in Media (a row's trimmed video,
 * a combined video) copied where the operator chooses, a save dialog beginning in Downloads, byte for byte: never
 * encoded again, never over a file already there (a free name beside it then), the library's own file never changed.
 */

export interface ExportFileDeps {
  /** A video in Media there to play: its file (absolute) and its name; null otherwise. */
  video(mediaId: string): { path: string; name: string } | null;
  /** Where to save it: a save dialog with this name to begin with (null: closed). */
  pickDest(name: string): Promise<string | null>;
}

const GONE = 'That video is no longer in Media to export.';

export async function exportMediaFile(deps: ExportFileDeps, mediaId: string): Promise<ExportFileResult> {
  const video = deps.video(mediaId);
  if (!video) return { ok: false, message: GONE };
  const chosen = await deps.pickDest(video.name);
  if (chosen === null) return { ok: true, path: null };
  // Read again: it may have gone while the dialog was open.
  const now = deps.video(mediaId);
  if (now?.path !== video.path) return { ok: false, message: GONE };
  const dest = join(dirname(chosen), freeFileName(dirname(chosen), basename(chosen)));
  try {
    await copyFile(video.path, dest, constants.COPYFILE_EXCL);
    return { ok: true, path: dest };
  } catch (error) {
    // A file that came there meanwhile (EEXIST) is not ours to remove; only a part this copy made is.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      await rm(dest, { force: true }).catch(() => undefined);
    return {
      ok: false,
      message:
        'Drashti could not export it there. Check the folder and its free space, then try Export… again.',
    };
  }
}
