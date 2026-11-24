import { PDFDocument } from 'pdf-lib';
import type { CropRect } from './picture-look';

/** CropBox edits on the assembled copy only; neither page contents nor source bytes are changed. */
export async function cropPdfCopy(data: Uint8Array, crops: (CropRect | undefined)[]): Promise<Uint8Array> {
  if (!crops.some(Boolean)) return data;
  const doc = await PDFDocument.load(data.slice(), { updateMetadata: false });
  if (crops.length !== doc.getPageCount()) throw new Error('The PDF crop page count does not match.');
  for (const [index, page] of doc.getPages().entries()) {
    const crop = crops[index];
    if (!crop) continue;
    const media = page.getMediaBox();
    const box = page.getCropBox();
    // PDF.js displays the intersection of CropBox and MediaBox (or MediaBox if disjoint).
    const left = Math.max(media.x, box.x), bottom = Math.max(media.y, box.y);
    const right = Math.min(media.x + media.width, box.x + box.width);
    const top = Math.min(media.y + media.height, box.y + box.height);
    const view = right > left && top > bottom
      ? { x: left, y: bottom, width: right - left, height: top - bottom }
      : media;
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    // Map displayed top-left shares back to the page's unrotated bottom-left coordinates.
    let x: number, y: number, w: number, h: number;
    switch (rotation) {
      case 90: x = crop.y; y = crop.x; w = crop.h; h = crop.w; break;
      case 180: x = 1 - crop.x - crop.w; y = crop.y; w = crop.w; h = crop.h; break;
      case 270: x = 1 - crop.y - crop.h; y = 1 - crop.x - crop.w; w = crop.h; h = crop.w; break;
      default: x = crop.x; y = 1 - crop.y - crop.h; w = crop.w; h = crop.h;
    }
    // Decimal shares should not introduce visible fractional noise into integer page boxes.
    const point = (n: number) => Math.round(n * 1e10) / 1e10;
    page.setCropBox(point(view.x + x * view.width), point(view.y + y * view.height),
      point(w * view.width), point(h * view.height));
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}
