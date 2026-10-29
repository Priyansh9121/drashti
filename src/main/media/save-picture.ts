import { randomUUID } from 'node:crypto';
import { copyFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isJpegExtension, savedPictureName } from '../../shared/media';
import type { PictureLook } from '../../shared/picture-look';
import { FULL_CROP, hasEdit } from '../../shared/picture-look';
import { fileProblem } from '../plain-errors';
import type { BlurRun } from './blurred';

/*
 * Save picture… (Session 55, Part 5): any picture, or a deck's slide, saved full size where the operator chooses,
 * as "<name>.jpg" for a photo (a JPEG) and "<name>.png" for anything else ("<deck>_3.png" for a deck's slide). It is
 * the picture as it shows: turned, flipped and cropped as its look says (its own pixels, never made smaller); its
 * brightness, contrast, colour and sharpness are the projector's and are left as the file has them. A picture with
 * no turn, flip or crop that is a JPEG or a PNG already is copied as it is, byte for byte; any other is made by the
 * bundled FFmpeg (which turns a photo by its EXIF orientation first, as the screens and the Picture editor do).
 */

/** The file name a picture is saved as (shared/media.ts: the phone names its file the same way). */
export const savedName = savedPictureName;

/** Whether the picture is saved as a JPEG: a photo that is one (any of a JPEG's names); anything else, a PNG. */
export const savesAsJpeg = (ext: string): boolean => isJpegExtension(ext);

/** FFmpeg's filters for a look's turn, flips and crop, in that order, as the screens draw them ('' for none). */
export function editFilters(look: PictureLook | null): string {
  if (!look || !hasEdit(look)) return '';
  const parts: string[] = [];
  const turn = look.turn ?? 0;
  if (turn === 90) parts.push('transpose=clock');
  else if (turn === 180) parts.push('hflip', 'vflip');
  else if (turn === 270) parts.push('transpose=cclock');
  if (look.flipX === true) parts.push('hflip');
  if (look.flipY === true) parts.push('vflip');
  const c = look.crop ?? FULL_CROP;
  if (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1) {
    const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
    parts.push(
      `crop=w=floor(iw*${n(c.w)}):h=floor(ih*${n(c.h)}):x=floor(iw*${n(c.x)}):y=floor(ih*${n(c.y)})`,
    );
  }
  return parts.join(',');
}

/** FFmpeg's arguments to save a picture full size, turned, flipped and cropped, as a JPEG or a PNG. */
export function savePictureArgs(
  input: string,
  output: string,
  look: PictureLook | null,
  jpeg: boolean,
): string[] {
  const filters = editFilters(look);
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file',
    '-y',
    '-i',
    input,
    '-frames:v',
    '1',
    ...(filters ? ['-vf', filters] : []),
    ...(jpeg ? ['-q:v', '2'] : []),
    output,
  ];
}

/**
 * Save a picture's file (`source`, in the media folder) to `target` as it shows: copied as it is when nothing in its
 * look changes it and it is a JPEG or a PNG already, else made by FFmpeg (`run`). Written beside the target first and
 * moved into place, so a half-made file is never left there.
 */
export async function savePicture(
  source: string,
  sourceExt: string,
  target: string,
  look: PictureLook | null,
  run: BlurRun,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const jpeg = savesAsJpeg(sourceExt);
  const asIs = !hasEdit(look) && (jpeg || sourceExt.toLowerCase() === 'png');
  const partial = join(dirname(target), `.drashti-${randomUUID()}.${jpeg ? 'jpg' : 'png'}`);
  try {
    if (asIs) await copyFile(source, partial);
    else if (!(await run(savePictureArgs(source, partial, look, jpeg))))
      return { ok: false, message: 'Drashti could not make this picture: it could not be read.' };
    const made = await stat(partial);
    if (made.size === 0)
      return { ok: false, message: 'Drashti could not make this picture: it came out empty.' };
    await rename(partial, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `The picture could not be saved there. ${fileProblem(error, 'own')}` };
  } finally {
    await rm(partial, { force: true }).catch(() => undefined);
  }
}
