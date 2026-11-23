import type { EditDoc } from './slide-edit';
export interface PdfHandout { header: string; footer: string; watermark: string; numbers: boolean }
export function pdfHandout(_doc: EditDoc, _values: PdfHandout): EditDoc {
  throw new Error('PDF hand-out master is not yet implemented.');
}
