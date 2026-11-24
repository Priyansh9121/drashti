import { z } from 'zod';
import type { MediaElement, RenderSlide } from './model';
import type { CropRect, PictureLook, Turn } from './picture-look';

/*
 * Save picture… of a slide's picture (Session 55, Part 5), on a phone and in the operator's right-click menu: the
 * picture as its slide shows it on the screens, beyond its own look (a22-x95nits).
 */

/** How a slide shows its picture beyond the picture's own look, in the order the screens draw it. */
export interface OnSlide {
  /** The part of the picture its slide keeps (a crop of its own), as fractions of the picture as its look shows it. */
  crop?: CropRect;
  /** Then flipped in its frame, across and up and down. */
  flipX?: boolean;
  flipY?: boolean;
  /** Then turned clockwise about its middle, in quarter turns (Turn page right's). */
  turn?: Turn;
  /** Then the part of that a page cropped with Crop page… keeps, as fractions of it as it then shows. */
  part?: CropRect;
}

const share = z.number().min(0).max(1);
const partSchema = z
  .object({ x: share, y: share, w: share.gt(0), h: share.gt(0) })
  .strict()
  .refine((c) => c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001);

/** What the operator window may hand the main process with Save picture… (src/main/index.ts checks it). */
export const onSlideSchema: z.ZodType<OnSlide> = z
  .object({
    crop: partSchema.optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    part: partSchema.optional(),
  })
  .strict();

/** How `slide` shows its picture `element`, beyond the picture's own look; null for nothing more. */
export function onSlideOf(_element: MediaElement, _slide: RenderSlide): OnSlide | null {
  return null;
}

/** The picture's look with what its slide does to it after: the picture as the screens show it on that slide. */
export function lookOnSlide(look: PictureLook | null, _on: OnSlide | null): PictureLook | null {
  return look;
}
