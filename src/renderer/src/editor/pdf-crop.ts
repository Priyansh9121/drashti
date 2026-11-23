import type { CropRect } from '../../../shared/picture-look';
import type { EditDoc } from '../../../shared/slide-edit';
export type PdfCropPages = 'this' | 'every' | 'odd' | 'even';
export function cropPdfPages(_doc: EditDoc, _slideId: string, _crop: CropRect, _pages: PdfCropPages): EditDoc {
  throw new Error('PDF page crop is not implemented yet.');
}
