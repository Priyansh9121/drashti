import { nativeImage } from 'electron';
import type { CapturedPicture } from '../../shared/pdf-copy';

/*
 * The byte order of a captured picture's pixels on this computer (Session 57, C6's review, MEDIUM 1): Electron says
 * nativeImage.toBitmap()'s is the platform's (blue first on a Mac and on Windows), so it is found once, from a red
 * pixel, for the network's process to make the phone's PNG right (network/png.ts).
 */

/** One red pixel, as a PNG. */
const RED_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

let found: CapturedPicture['order'] | null = null;

export function capturedPixelOrder(): CapturedPicture['order'] {
  found ??= nativeImage.createFromDataURL(RED_PIXEL).toBitmap()[0] === 255 ? 'rgba' : 'bgra';
  return found;
}
