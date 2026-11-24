import type { CropRect } from '../../../shared/picture-look';
import { pagePartSchema } from '../../../shared/page-part';
import type { EditDoc } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
export type PdfCropPages = 'this' | 'every' | 'odd' | 'even';
/** A presentation step, without converting or changing any source page content. */
export function cropPdfPages(doc: EditDoc, slideId: string, crop: CropRect, pages: PdfCropPages): EditDoc {
  if (
    !pagePartSchema.safeParse(crop).success ||
    !slidesOf(doc).some((s) => s.id === slideId && s.documentPage?.ext === 'pdf')
  )
    return doc;
  let index = 0;
  const whole = crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
  return {
    ...doc,
    groups: doc.groups.map((group) => ({
      ...group,
      slides: group.slides.map((slide) => {
        const at = index++;
        if (
          slide.documentPage?.ext !== 'pdf' ||
          !(
            pages === 'every' ||
            (pages === 'this' ? slide.id === slideId : pages === 'odd' ? at % 2 === 0 : at % 2 === 1)
          )
        )
          return slide;
        const { crop: _crop, ...ref } = slide.documentPage;
        return { ...slide, documentPage: { ...ref, ...(whole ? {} : { crop: { ...crop } }) } };
      }),
    })),
  };
}
