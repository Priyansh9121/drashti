import { sharpenPixels } from '../../../shared/picture-look';
import type { SharpenJobView } from '../../../shared/pictures';

/*
 * The hidden window that makes pictures' sharpened copies (Session 26f;
 * src/main/media/sharpened.ts): each picture decoded as the screens decode
 * it (its turn, its colours), drawn at its own size, its pixels sharpened
 * with the screens' old filter's kernel, and handed back as a JPEG or a PNG.
 * One at a time; the main process runs this window's process at the lowest
 * priority and closes it when nothing is left.
 */

async function sharpen(job: SharpenJobView): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(job.data)]));
  const { width, height } = bitmap;
  if (width * height > job.maxPixels) {
    bitmap.close();
    throw new Error('too many pixels');
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('nothing to draw with');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, width, height);
  image.data.set(sharpenPixels(image.data, width, height, job.percent));
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: job.type, quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function run(): Promise<void> {
  for (let job = await window.drashti.sharpen.next(); job; job = await window.drashti.sharpen.next()) {
    let made: Uint8Array | null;
    try {
      made = await sharpen(job);
    } catch {
      made = null;
    }
    await window.drashti.sharpen.made(job.key, made);
    // A moment between pictures: this window's process never holds on to the processor.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
