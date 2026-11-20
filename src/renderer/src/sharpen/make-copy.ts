import { copySize, sharpenPixels } from '../../../shared/picture-look';
import type { SharpenJobView } from '../../../shared/pictures';

export async function makePictureCopy(job: SharpenJobView): Promise<Uint8Array> {
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
