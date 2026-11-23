import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
export function selectPdfPages(_doc: EditDoc, _indices: number[]): EditDoc | null {
  throw new Error('PDF page extraction is not yet implemented.');
}
export function replacePdfPage(_doc: EditDoc, _id: string, _page: EditSlide): EditDoc | null {
  throw new Error('PDF page replacement is not yet implemented.');
}
export function splitPdfPages(_doc: EditDoc, _id: string): [EditDoc, EditDoc] | null {
  throw new Error('PDF split is not yet implemented.');
}
