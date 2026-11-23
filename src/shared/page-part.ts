import { z } from 'zod';
import type { CropRect } from './picture-look';
import type { EditDoc } from './slide-edit';
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
  const w = Math.max(part.w * page.width, Number.MIN_VALUE);
  const h = Math.max(part.h * page.height, Number.MIN_VALUE);
  const scale = Math.min(room.width / w, room.height / h);
  return {
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    dx: part.x * page.width * scale,
    dy: part.y * page.height * scale,
  };
}

/** A presentation's name is at most this long. */
const NAME_MAX = 200;

/** The made slide's name: the presentation's, its page's number, and "(part)" for a part of it. */
export function madeSlideName(presentation: string, pageNumber: number, whole: boolean): string {
  const end = `, page ${String(pageNumber)}${whole ? '' : ' (part)'}`;
  return `${cutText(presentation.trim(), NAME_MAX - end.length, '…')}${end}`;
}

/** The editor's Make the slide: its document as it is now (unsaved changes too), the page, the part and the place. */
export interface MakeSlideRequest {
  presentationId: string;
  doc: EditDoc;
  stamp: string;
  slideId: string;
  part: PagePart;
  place: MadeSlidePlace;
}

/** The slide made (its presentation's name, and the playlist it went into, or null for the library only), or why not. */
export type MakeSlideResult =
  | { ok: true; presentationId: string; name: string; playlist: string | null }
  | { ok: false; message: string };

/** Where Make a slide… can put the slide now: the operator window's open playlist (Pro Mode), or none. */
export interface SlidePlace {
  playlist: { id: string; name: string } | null;
}

/** main -> the operator window: a slide was made (for its Undo: the row, then the presentation). */
export interface SlideMade {
  presentationId: string;
  name: string;
  /** The open playlist's new row, or null when it went into the library only. */
  itemId: string | null;
}
