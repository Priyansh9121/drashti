import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  OPENING_COPY_MAX_BYTES,
  OPENING_LINES_MAX,
  OPENING_PHOTOS_MAX,
  PACK_EXTENSIONS,
  PACK_PHOTOS,
  PACK_WORDS,
  packLines,
  packMissing,
} from '../../shared/opening';
import { fileProblem } from '../plain-errors';
import { openingCopyPath } from '../media/media-protocol';
import { isJpeg } from '../media/stills';

export { openingCopyPath };

/*
 * The opening's files (Session 55, the owner's addition of 3 Nov 2026):
 *
 * - The opening pack a mandir is given on the setup day: a folder with photos/1.jpg to photos/8.jpg (a .jpeg or a
 *   .png too, in any case) and words.txt, its five lines in order. Read whole for Load the opening pack…: a pack
 *   missing a photo or a line says what, and nothing changes. Drashti only reads the folder.
 * - The opening's own copy of each photo, at most the operator window's size (shared/opening.ts), so the opening
 *   never decodes a photo's whole original as Drashti starts. The operator window draws each copy (as it draws a
 *   video's still) and main keeps it in the media folder's opening/, under the photo's sha256, beside the stills.
 */

const SHA256 = /^[0-9a-f]{64}$/u;
const PHOTO = new RegExp(`^([1-${String(OPENING_PHOTOS_MAX)}])\\.(${PACK_EXTENSIONS.join('|')})$`, 'iu');

export type PackRead = { ok: true; photos: string[]; lines: string[] } | { ok: false; message: string };

/** An opening pack's photos (1 to 8, in order) and its first five lines, or what it is missing. */
export async function readPack(dir: string): Promise<PackRead> {
  const names = await readdir(join(dir, PACK_PHOTOS)).catch(() => [] as string[]);
  const byNumber = new Map<number, string>();
  for (const name of [...names].sort()) {
    const n = Number(PHOTO.exec(name)?.[1]);
    if (n >= 1 && !byNumber.has(n)) byNumber.set(n, join(dir, PACK_PHOTOS, name));
  }
  const text = await readFile(join(dir, PACK_WORDS), 'utf8').catch(() => '');
  const lines = packLines(text).slice(0, OPENING_LINES_MAX);
  const missing = packMissing({ photos: [...byNumber.keys()], lines: lines.length });
  if (missing) return { ok: false, message: missing };
  const photos = Array.from({ length: OPENING_PHOTOS_MAX }, (_, i) => byNumber.get(i + 1) ?? '');
  return { ok: true, photos, lines };
}

/** Keep a photo's opening copy (one whole JPEG), replacing any older one. */
export async function saveOpeningCopy(
  mediaDir: string,
  sha256: string,
  bytes: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!SHA256.test(sha256)) return { ok: false, message: 'That photo has no file.' };
  if (!(bytes instanceof Uint8Array) || !isJpeg(bytes) || bytes.length > OPENING_COPY_MAX_BYTES)
    return { ok: false, message: 'The opening’s copy of a photo must be one JPEG under 4 MB.' };
  const file = join(mediaDir, openingCopyPath(sha256));
  const part = `${file}.${randomUUID()}.part`;
  try {
    await mkdir(join(mediaDir, 'opening'), { recursive: true });
    await writeFile(part, bytes);
    await rename(part, file);
    return { ok: true };
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined);
    return { ok: false, message: `Could not keep the opening’s copy of a photo. ${fileProblem(error, 'own')}` };
  }
}
