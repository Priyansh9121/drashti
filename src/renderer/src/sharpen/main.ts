import { copySize, sharpenPixels } from '../../../shared/picture-look';
import type { SharpenJobView } from '../../../shared/pictures';

/*
 * The hidden window that makes pictures' sharpened copies (Session 26f;
 * src/main/media/sharpened.ts): each picture decoded as the screens decode
 * it (its turn, its colours), drawn at the size the screens draw it (Session 26g), its pixels sharpened
 * with the screens' old filter's kernel, and handed back as a JPEG or a PNG.
 * One at a time; the main process runs this window's process at the lowest
 * priority and closes it when nothing is left.
 */

async function sharpen(job: SharpenJobView): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(job.data)]));
  if (bitmap.width * bitmap.height > job.maxPixels) {
    bitmap.close();
    throw new Error('too many pixels');
  }
  if (job.sourceSize && (bitmap.width !== job.sourceSize.width || bitmap.height !== job.sourceSize.height)) {
    bitmap.close();
    throw new Error('source dimensions changed');
  }
  // At the size the screens draw it (Session 26g), never bigger than it is: the sharpening seen there.
  const { width, height } = job.resizeOnly && job.box ? job.box : copySize(bitmap, job.box);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('nothing to draw with');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  if (!job.resizeOnly) {
    const image = ctx.getImageData(0, 0, width, height);
    image.data.set(sharpenPixels(image.data, width, height, job.percent));
    ctx.putImageData(image, 0, 0);
  }
  const blob = await canvas.convertToBlob({ type: job.type, quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function run(): Promise<void> {
  const service = new URLSearchParams(location.search).get('purpose') === 'display' ? window.drashti.displayCopies : window.drashti.sharpen;
  for (let job = await service.next(); job; job = await service.next()) {
    let made: Uint8Array | null;
    try {
      made = await sharpen(job);
    } catch {
      made = null;
    }
    await service.made(job.key, made);
    // A moment between pictures: this window's process never holds on to the processor.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

void run();
