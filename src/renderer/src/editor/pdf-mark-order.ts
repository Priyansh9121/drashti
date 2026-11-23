import type { EditDoc } from '../../../shared/slide-edit';
import type { ShapeElement } from '../../../shared/model';
import { isPdfMark, orderedPdfMarks } from '../../../shared/pdf-mark-motion';
import { findSlide, mapSlide } from './ops';

/** One caller commit makes the whole selection's change undoable together. */
export function setPdfMarkClick(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  enabled: boolean,
): EditDoc {
  const slide = findSlide(doc, slideId);
  if (doc.master?.id === slideId || slide?.documentPage?.ext !== 'pdf' || slide.deck) return doc;
  const selected = slide.elements.filter(
    (element): element is ShapeElement => element.kind === 'shape' && ids.includes(element.id),
  );
  if (!selected.some((mark) => (mark.pdfMark?.clickOrder !== undefined) !== enabled)) return doc;
  const old = orderedPdfMarks(slide.elements, true);
  const order = enabled
    ? [...old, ...selected.filter((mark) => mark.pdfMark?.clickOrder === undefined)]
    : old.filter((mark) => !ids.includes(mark.id));
  const ranks = new Map(order.map((mark, index) => [mark.id, index + 1]));
  return mapSlide(doc, slideId, (page) => ({
    ...page,
    elements: page.elements.map((element) => {
      if (element.kind !== 'shape' || (!isPdfMark(element) && !ranks.has(element.id))) return element;
      const clickOrder = ranks.get(element.id);
      const { clickOrder: _old, ...mark } = element.pdfMark ?? {};
      return { ...element, pdfMark: { ...mark, ...(clickOrder === undefined ? {} : { clickOrder }) } };
    }),
  }));
}
