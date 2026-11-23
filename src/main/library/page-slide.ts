import type { NewPresentation } from '../db/presentations';
import type { MediaElement } from '../../shared/model';

/*
 * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): a PDF page, or the part of
 * it dragged out in the slide editor, drawn from the page itself as a picture at the hall's size (shared/page-part.ts)
 * and kept in the library through an import as any picture is; this is the presentation that holds it: one slide,
 * the picture fitted to the whole slide on black, as a PDF's pages are, at the size the hall's pictures are made at.
 */

export function pageSlidePresentation(
  libraryId: string,
  name: string,
  mediaId: string | string[],
  size: { width: number; height: number },
): NewPresentation & { width: number; height: number } {
  const page = (id: string): MediaElement => ({
    id: 'page',
    kind: 'image',
    frame: { x: 0, y: 0, width: size.width, height: size.height },
    mediaId: id,
    fit: 'fit',
  });
  const pictures = typeof mediaId === 'string' ? [mediaId] : mediaId;
  return {
    libraryId,
    name,
    width: size.width,
    height: size.height,
    groups: [
      {
        name: '',
        color: null,
        slides: pictures.map((id) => ({ elements: [page(id)], background: '#000000' })),
      },
    ],
    arrangements: [],
    selectedArrangement: null,
    source: { kind: 'drashti', path: null, ref: null, importedAt: null },
  };
}
