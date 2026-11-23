import type { NewPresentation } from '../db/presentations';

/*
 * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): a PDF page, or the part of
 * it dragged out in the slide editor, drawn from the page itself as a picture at the hall's size (shared/page-part.ts)
 * and kept in the library through an import as any picture is; this is the presentation that holds it: one slide,
 * the picture fitted to the whole slide on black, as a PDF's pages are, at the size the hall's pictures are made at.
 */

export function pageSlidePresentation(
  libraryId: string,
  name: string,
  mediaId: string,
  size: { width: number; height: number },
): NewPresentation & { width: number; height: number } {
  void libraryId;
  void name;
  void mediaId;
  void size;
  throw new Error('not yet');
}
