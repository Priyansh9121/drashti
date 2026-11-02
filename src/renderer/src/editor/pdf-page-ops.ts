import type { SlideElement } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { editingCanvas } from '../../../shared/document-page';
import { findSlide, mapSlide, removeSlide } from './ops';

/** Turn a native element around the page, keeping its own local content intact. */
function turnedElement(element: SlideElement, pageHeight: number): SlideElement {
  const { frame, rotation: originalRotation, ...content } = element;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const rotation = ((((originalRotation ?? 0) + 90) % 360) + 360) % 360;
  return {
    ...content,
    frame: { ...frame, x: pageHeight - cy - frame.width / 2, y: cx - frame.height / 2 },
    ...(rotation ? { rotation } : {}),
  };
}

/** One real content edit; conversion/history is applied by the caller's commit. */
export function turnPdfPageRight(doc: EditDoc, slideId: string): EditDoc {
  if (doc.master?.id === slideId) return doc;
  const slide = findSlide(doc, slideId);
  if (slide?.documentPage?.ext !== 'pdf') return doc;
  const source = slide.documentPage;
  // Older optional rotation may not be applied to these native coordinates.
  // An explicit prepared pageSize is the unambiguous current canvas contract.
  if (!slide.pageSize && source.rotation) return doc;
  const size = slide.pageSize ?? editingCanvas(source, doc);
  return mapSlide(doc, slideId, (page) => ({
    ...page,
    pageSize: { width: size.height, height: size.width },
    documentPage: { ...source, rotation: 0 },
    elements: page.elements.map((element) => turnedElement(element, size.height)),
    ...(page.guides
      ? {
          guides: {
            x: page.guides.y.map((y) => size.height - y).sort((a, b) => a - b),
            y: [...page.guides.x].sort((a, b) => a - b),
          },
        }
      : {}),
  }));
}

/** Structural page removal preserves source occurrence identity on all survivors. */
export function deletePdfPage(doc: EditDoc, slideId: string): { doc: EditDoc; show: string } | null {
  if (doc.master?.id === slideId || findSlide(doc, slideId)?.documentPage?.ext !== 'pdf') return null;
  const pages = slidesOf(doc);
  const at = pages.findIndex((page) => page.id === slideId);
  const next = pages[at + 1] ?? pages[at - 1];
  if (!next) return null;
  return { doc: removeSlide(doc, slideId), show: next.id };
}
