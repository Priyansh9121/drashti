import { mediaUrl } from '../../../shared/media';
import { OPENING_COPY_HEIGHT, OPENING_COPY_WIDTH } from '../../../shared/opening';

/*
 * A photo's copy for the opening (Session 55): drawn here, once, at most the operator window's size (shared/opening.ts),
 * and kept by the main process in the media folder (main/opening/opening-files.ts), so the opening never decodes a
 * photo's whole original as Drashti starts. Made as File › Opening… chooses a photo or loads the opening pack, one at
 * a time; Chromium draws the photo as the screens do (its turn, its colours).
 */

/** Make one photo's copy: true once it is kept. */
export async function makeOpeningCopy(mediaId: string): Promise<boolean> {
  const img = new Image();
  // CORS, so the canvas can be read back (the media scheme allows it for Drashti's pages).
  img.crossOrigin = 'anonymous';
  img.src = mediaUrl(mediaId);
  try {
    await img.decode();
    const scale = Math.min(
      1,
      OPENING_COPY_WIDTH / Math.max(1, img.naturalWidth),
      OPENING_COPY_HEIGHT / Math.max(1, img.naturalHeight),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.88);
    });
    if (!blob) return false;
    const saved = await window.drashti.opening.saveCopy(mediaId, new Uint8Array(await blob.arrayBuffer()));
    return saved.ok;
  } catch {
    return false;
  } finally {
    img.removeAttribute('src');
  }
}

let making: Promise<void> = Promise.resolve();

/** Make the copies of these photos, one after another (after any being made already); `each` as each is done. */
export function makeOpeningCopies(mediaIds: readonly string[], each: () => void): Promise<void> {
  making = making.then(async () => {
    for (const id of mediaIds) {
      await makeOpeningCopy(id);
      each();
    }
  });
  return making;
}
