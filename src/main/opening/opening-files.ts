import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  OPENING_COPY_MAX_BYTES,
  OPENING_SOUND_MAX_BYTES,
  type OpeningSound,
  type OpeningSoundKind,
  PACK_PHOTOS,
  packMissing,
  packPhotoOf,
  packSoundOf,
  packSoundProblem,
  packSoundsMessage,
} from '../../shared/opening';
import { probeMedia } from '../import/probe';
import { fileProblem } from '../plain-errors';
import { openingCopyPath, openingSoundPath } from '../media/media-protocol';
import { isJpeg } from '../media/stills';

export { openingCopyPath, openingSoundPath };

/*
 * The opening's files (Session 55, the owner's addition of 3 Nov 2026; alpha.16, his words of 11 Nov 2026):
 *
 * - The opening pack a mandir is given on the setup day: a folder with photos/1.jpg (a .jpeg or a .png too, in any
 *   case) and, if it has one, its own sound at its top: sound.mp3, sound.m4a or sound.wav (in any case). Photo 1 is
 *   enough: an alpha.15 pack's photos 2 to 8 and its words.txt are left alone. Read whole for Load the opening pack…: a
 *   pack without its photo 1, or whose sound Drashti cannot take, says why, and nothing changes. Drashti only reads
 *   the folder.
 * - The opening's own copy of its photo, at most the operator window's size (shared/opening.ts), so the opening never
 *   decodes a photo's whole original as Drashti starts. The operator window draws it (as it draws a video's still) and
 *   main keeps it in the media folder's opening/, under the photo's sha256, beside the stills.
 * - The copy of the pack's sound Drashti keeps, in the same folder under its own sha256 and kind, so the pack's folder
 *   can go once it is loaded; a backup carries it with the rest of the media folder.
 */

const SHA256 = /^[0-9a-f]{64}$/u;

/** The pack's sound as found: its file, its name in the pack, and its kind. */
export interface PackSound {
  path: string;
  name: string;
  kind: OpeningSoundKind;
}

export type PackRead = { ok: true; photo: string; sound: PackSound | null } | { ok: false; message: string };

/** The names in a folder, or none when it cannot be read. */
const namesIn = (dir: string): Promise<string[]> => readdir(dir).catch(() => [] as string[]);

/** An opening pack's photo 1 and its sound (if any, and one Drashti can take), or why it cannot be loaded. */
export async function readPack(dir: string): Promise<PackRead> {
  const photo = packPhotoOf(await namesIn(join(dir, PACK_PHOTOS)));
  const missing = packMissing({ photo: photo !== null });
  if (missing || photo === null) return { ok: false, message: missing ?? '' };
  // Its sound: a file at its top, never a folder of that name.
  const top: string[] = [];
  for (const name of await namesIn(dir)) {
    const found = await stat(join(dir, name)).catch(() => null);
    if (found?.isFile()) top.push(name);
  }
  const sound = packSoundOf(top);
  if (sound && 'several' in sound) return { ok: false, message: packSoundsMessage(sound.several) };
  const photoPath = join(dir, PACK_PHOTOS, photo);
  if (!sound) return { ok: true, photo: photoPath, sound: null };
  const path = join(dir, sound.name);
  const bytes = (await stat(path).catch(() => null))?.size ?? 0;
  // What it is, from its bytes (as an import reads a file), never its name.
  const probe = await probeMedia(path);
  const problem = packSoundProblem({ name: sound.name, bytes, ...probe });
  if (problem) return { ok: false, message: problem };
  return { ok: true, photo: photoPath, sound: { path, name: sound.name, kind: sound.kind } };
}

/** Write a file whole, by a temporary file renamed into place, so a half-written one never takes its name. */
async function writeWhole(file: string, bytes: Uint8Array): Promise<void> {
  const part = `${file}.${randomUUID()}.part`;
  try {
    await writeFile(part, bytes);
    await rename(part, file);
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Keep a copy of the pack's sound in the media folder's opening/, named by its sha256: what the opening keeps. */
export async function keepSoundCopy(
  mediaDir: string,
  sound: PackSound,
): Promise<{ ok: true; sound: OpeningSound } | { ok: false; message: string }> {
  try {
    const bytes = await readFile(sound.path);
    if (bytes.length > OPENING_SOUND_MAX_BYTES)
      return {
        ok: false,
        message: packSoundProblem({ name: sound.name, bytes: bytes.length, kind: 'audio', playable: true, format: '' }) ?? '',
      };
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const kept: OpeningSound = { sha256, kind: sound.kind, name: sound.name };
    await mkdir(join(mediaDir, 'opening'), { recursive: true });
    await writeWhole(join(mediaDir, openingSoundPath(kept)), bytes);
    return { ok: true, sound: kept };
  } catch (error) {
    return { ok: false, message: `Could not keep the opening’s sound. ${fileProblem(error, 'own')}` };
  }
}

/** The copy of a sound the opening no longer keeps, gone (none there is no harm). */
export async function dropSoundCopy(mediaDir: string, sound: Pick<OpeningSound, 'sha256' | 'kind'>): Promise<void> {
  if (!SHA256.test(sound.sha256)) return;
  await rm(join(mediaDir, openingSoundPath(sound)), { force: true }).catch(() => undefined);
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
  try {
    await mkdir(join(mediaDir, 'opening'), { recursive: true });
    await writeWhole(join(mediaDir, openingCopyPath(sha256)), bytes);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Could not keep the opening’s copy of a photo. ${fileProblem(error, 'own')}`,
    };
  }
}
