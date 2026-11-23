import { pdfPageIndices } from '../../../shared/pdf-page-selection';
import { slidesOf, type EditDoc, type EditSlide } from '../../../shared/slide-edit';

/** Preserve source provenance until Main validates and assigns new stored identities. */
export function selectPdfPages(doc: EditDoc, indices: number[]): EditDoc | null {
  const pages = slidesOf(doc);
  if (!pdfPageIndices(indices, pages.length)) return null;
  const ids = new Set(pages.filter((_, index) => indices.includes(index)).map((page) => page.id));
  return {
    ...doc,
    groups: doc.groups
      .map((group) => ({ ...group, slides: group.slides.filter((page) => ids.has(page.id)) }))
      .filter((group) => group.slides.length > 0),
  };
}

/** An imported replacement has Main-issued provenance; the caller commits one history step. */
export function replacePdfPage(doc: EditDoc, id: string, page: EditSlide): EditDoc | null {
  const pages = slidesOf(doc);
  if (
    page.documentPage?.ext !== 'pdf' ||
    !pages.some((p) => p.id === id && p.documentPage?.ext === 'pdf') ||
    pages.some((p) => p.id === page.id && p.id !== id)
  )
    return null;
  return {
    ...doc,
    groups: doc.groups.map((group) => ({
      ...group,
      slides: group.slides.map((old) => (old.id === id ? page : old)),
    })),
  };
}

/** Split before this page; both parts must keep at least one page. */
export function splitPdfPages(doc: EditDoc, id: string): [EditDoc, EditDoc] | null {
  const pages = slidesOf(doc);
  const at = pages.findIndex((page) => page.id === id);
  if (at <= 0 || pages[at]?.documentPage?.ext !== 'pdf') return null;
  const first = selectPdfPages(
    doc,
    pages.slice(0, at).map((_, i) => i),
  );
  const second = selectPdfPages(
    doc,
    pages.slice(at).map((_, i) => i + at),
  );
  return first && second ? [first, second] : null;
}
