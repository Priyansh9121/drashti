import { cutText } from '../../shared/text';
import { pdfPageIndices } from '../../shared/pdf-page-selection';
import { slidesOf, type EditDoc } from '../../shared/slide-edit';
import type { Db } from '../db/database';
import type { PresentationRepo } from '../db/presentations';
import { applySlideEdit } from './slides';

/** Called only with Main's validated snapshot. New identities and storage commit together. */
export function keepPdfPages(
  db: Db,
  repo: PresentationRepo,
  doc: EditDoc,
  indices: number[],
): { id: string; name: string } {
  const pages = slidesOf(doc);
  if (!pdfPageIndices(indices, pages.length)) throw new Error('Choose pages in document order.');
  const ids = new Set(pages.filter((_, index) => indices.includes(index)).map((page) => page.id));
  const chosen = {
    ...doc,
    groups: doc.groups
      .map((group) => ({ ...group, slides: group.slides.filter((page) => ids.has(page.id)) }))
      .filter((group) => group.slides.length),
  };
  return db.transaction(() => {
    const libraryId = (
      db
        .prepare('SELECT library_id FROM presentations WHERE id = ? AND deleted_at IS NULL')
        .get(doc.presentationId) as { library_id: string } | undefined
    )?.library_id;
    if (!libraryId) throw new Error('The presentation is no longer available.');
    const name = repo.uniqueName(libraryId, `${cutText(doc.name, 170)} pages`);
    const id = repo.insert({
      libraryId,
      name,
      width: doc.width,
      height: doc.height,
      groups: [],
      source: { kind: 'pictures', path: null, ref: null, importedAt: null },
    });
    const empty = repo.content(id);
    if (!empty) throw new Error('The new presentation could not be opened.');
    repo.setContent(applySlideEdit(empty, { ...chosen, presentationId: id, name }));
    return { id, name };
  })();
}
