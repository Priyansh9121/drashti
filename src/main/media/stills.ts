import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SaveStillResult } from '../../shared/media';
import { STILL_MAX_BYTES } from '../../shared/media';
import { stillPath } from './media-protocol';
import { fileProblem } from '../plain-errors';

/*
 * Still frames for thumbnails. Main cannot decode video, so the operator
 * window draws a frame on a canvas and sends the JPEG here, once per file:
 * it is kept in the media folder under the file's sha256.
 */

const SHA256 = /^[0-9a-f]{64}$/;

/** True for the bytes of one whole JPEG file (as canvas.toBlob writes it). */
export function isJpeg(bytes: Uint8Array): boolean {
  const n = bytes.length;
  return (
    n >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[n - 2] === 0xff &&
    bytes[n - 1] === 0xd9
  );
}

/** Keep a still frame for the media file with this sha256. */
export async function saveStill(mediaDir: string, sha256: string, bytes: unknown): Promise<SaveStillResult> {
  if (!SHA256.test(sha256)) return { ok: false, message: 'That media item has no file.' };
  if (!(bytes instanceof Uint8Array)) return { ok: false, message: 'A still frame must be a JPEG.' };
  if (bytes.length > STILL_MAX_BYTES) return { ok: false, message: 'That still frame is too large.' };
  if (!isJpeg(bytes)) return { ok: false, message: 'A still frame must be a JPEG.' };
  const target = join(mediaDir, stillPath(sha256));
  const partial = `${target}.part-${randomUUID()}`;
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(partial, bytes);
    await rename(partial, target);
    return { ok: true };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    return { ok: false, message: `Could not keep the still frame. ${fileProblem(error, 'own')}` };
  }
}
