import type { CropRect } from './picture-look';
/** CropBox edits on the PDF.js-assembled copy only; source files are never writable here. */
export function cropPdfCopy(_data: Uint8Array, _crops: (CropRect | undefined)[]): Promise<Uint8Array> {
  return Promise.reject(new Error('PDF copy CropBox writing is not implemented yet.'));
}
