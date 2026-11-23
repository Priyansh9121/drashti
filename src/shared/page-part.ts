import { z } from 'zod';
import type { CropRect } from './picture-look';
import { MIN_CROP } from './picture-look';
import { cutText } from './text';

/*
 * Make a slide… (alpha.21, the owner's "add a slide button to create a slide in drashti"): a PDF page in the slide
 * editor, or the part of it dragged out with the Picture editor's box, becomes a Drashti slide holding it as a
 * picture. The part is drawn from the page itself, with pdf.js, at the size the hall's pictures are made at (the
 * size a PDF's pages are imported at, main/pictures/pdf-pictures.ts pictureSize): as large as fits in it, its own
 * shape kept, so a small part of a page is as sharp on the screens as a whole page.
 */

/** The part of a page, in shares of it from its top-left (a CropRect, as the Picture editor's box keeps one). */
export type PagePart = CropRect;

/** A part's sides may run past the page by this much (sums of shares), no more. */
const EDGE = 1e-6;

export const pagePartSchema: z.ZodType<PagePart> = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z
      .number()
      .min(MIN_CROP - EDGE)
      .max(1),
    h: z
      .number()
      .min(MIN_CROP - EDGE)
      .max(1),
  })
  .refine((p) => p.x + p.w <= 1 + EDGE && p.y + p.h <= 1 + EDGE, 'The part must be on the page.');

/** Where the new slide goes: the open playlist (the operator window's, in Pro Mode) or the library only. */
export type MadeSlidePlace = 'playlist' | 'library';

/** How a part of a page is drawn: the page's scale, the picture's size, and how far the page moves left and up. */
export interface PartDrawing {
  scale: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
}

/**
 * Drawing `part` of a page of `page` size (points, as pdf.js gives it at scale 1) as large as fits in `room` (pixels),
 * keeping its shape: whole pixels, at least one each way.
 */
export function partDrawing(
  part: PagePart,
  page: { width: number; height: number },
  room: { width: number; height: number },
): PartDrawing {
  void part;
  void page;
  void room;
  throw new Error('not yet');
}

/** The made slide's name: the presentation's, its page's number, and "(part)" for a part of it. */
export function madeSlideName(presentation: string, pageNumber: number, whole: boolean): string {
  void presentation;
  void pageNumber;
  void whole;
  void cutText;
  throw new Error('not yet');
}
