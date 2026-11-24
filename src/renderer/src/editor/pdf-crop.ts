import type { CropRect } from '../../../shared/picture-look';
import { pagePartSchema } from '../../../shared/page-part';
import type { EditDoc } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
export type PdfCropPages = 'this' | 'every' | 'odd' | 'even';
/** The same part of a page: both the whole page (no crop), or the same edges. */
const samePart = (a: CropRect | undefined, b: CropRect | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * A presentation step, without converting or changing any source page content. The same document when every chosen
 * page already shows that part (Keep crop as the dialog opened, or The whole page on whole pages): no step for Undo.
 */
export function cropPdfPages(doc: EditDoc, slideId: string, crop: CropRect, pages: PdfCropPages): EditDoc {
  if (
    !pagePartSchema.safeParse(crop).success ||
    !slidesOf(doc).some((s) => s.id === slideId && s.documentPage?.ext === 'pdf')
  )
    return doc;
  let index = 0;
  const whole = crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
  const groups = doc.groups.map((group) => {
    const slides = group.slides.map((slide) => {
      const at = index++;
      if (
        slide.documentPage?.ext !== 'pdf' ||
        !(
          pages === 'every' ||
          (pages === 'this' ? slide.id === slideId : pages === 'odd' ? at % 2 === 0 : at % 2 === 1)
        )
      )
        return slide;
      const { crop: was, ...ref } = slide.documentPage;
      if (samePart(was, whole ? undefined : crop)) return slide;
      return { ...slide, documentPage: { ...ref, ...(whole ? {} : { crop: { ...crop } }) } };
    });
    return slides.some((slide, n) => slide !== group.slides[n]) ? { ...group, slides } : group;
  });
  return groups.some((group, n) => group !== doc.groups[n]) ? { ...doc, groups } : doc;
}
