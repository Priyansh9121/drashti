import { copySize, sharpenPixels } from '../../../shared/picture-look';
import type { SharpenJobView } from '../../../shared/pictures';
import { readDisplaySource } from './source-blob';

export async function makePictureBlob(job: SharpenJobView): Promise<Blob> {
  const source = job.resizeOnly
    ? await readDisplaySource(job.source, job.maxBytes)
    : new Blob([new Uint8Array(job.data)]);
  const bitmap = await createImageBitmap(source);
  const { canvas, ctx } = (() => {
    try {
      if (bitmap.width * bitmap.height > job.maxPixels) throw new Error('too many pixels');
      if (
        job.sourceSize &&
        (bitmap.width !== job.sourceSize.width || bitmap.height !== job.sourceSize.height)
      )
        throw new Error('source dimensions changed');
      const { width, height } = job.resizeOnly ? job.box : copySize(bitmap, job.box);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('nothing to draw with');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      return { canvas, ctx };
    } finally {
      bitmap.close();
    }
  })();
  if (!job.resizeOnly) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    image.data.set(sharpenPixels(image.data, canvas.width, canvas.height, job.percent));
    ctx.putImageData(image, 0, 0);
  }
  return canvas.convertToBlob({ type: job.type, quality: 0.95 });
}

/** The ordinary sharpen worker keeps its existing byte-array route. */
export async function makePictureCopy(job: SharpenJobView): Promise<Uint8Array> {
  const blob = await makePictureBlob(job);
  return new Uint8Array(await blob.arrayBuffer());
}
