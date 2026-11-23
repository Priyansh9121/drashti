import { slidesOf, type EditDoc, type EditSlide } from '../../../shared/slide-edit';

/** Preserve source provenance until Main validates and assigns new stored identities. */
export function selectPdfPages(doc: EditDoc, indices: number[]): EditDoc | null {
  const pages = slidesOf(doc);
  if (!indices.length || indices.some((n, i) => !Number.isInteger(n) || n < 0 || n >= pages.length || (i > 0 && n <= indices[i - 1]!))) return null;
  const ids = new Set(indices.map(n => pages[n]!.id));
  return {
    ...doc,
    groups: doc.groups.map(group => ({ ...group, slides: group.slides.filter(page => ids.has(page.id)) })).filter(group => group.slides.length > 0),
  };
}

/** An imported replacement has Main-issued provenance; the caller commits one history step. */
export function replacePdfPage(doc: EditDoc, id: string, page: EditSlide): EditDoc | null {
  const pages = slidesOf(doc);
  if (page.documentPage?.ext !== 'pdf' || !pages.some(p => p.id === id && p.documentPage?.ext === 'pdf') || pages.some(p => p.id === page.id && p.id !== id)) return null;
  return { ...doc, groups: doc.groups.map(group => ({ ...group, slides: group.slides.map(old => old.id === id ? page : old) })) };
}

/** Split before this page; both parts must keep at least one page. */
export function splitPdfPages(doc: EditDoc, id: string): [EditDoc, EditDoc] | null {
  const pages = slidesOf(doc);
  const at = pages.findIndex(page => page.id === id);
  if (at <= 0 || pages.some(page => page.documentPage?.ext !== 'pdf')) return null;
  const first = selectPdfPages(doc, pages.slice(0, at).map((_, i) => i));
  const second = selectPdfPages(doc, pages.slice(at).map((_, i) => i + at));
  return first && second ? [first, second] : null;
}
