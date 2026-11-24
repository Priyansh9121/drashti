import { z } from 'zod';
import type { MediaElement, RenderSlide } from './model';
import {
  type CropRect,
  FULL_CROP,
  flipAcross,
  flipUpDown,
  PLAIN,
  type PictureLook,
  type Turn,
  turnClockwise,
} from './picture-look';

/*
 * Save picture… of a slide's picture (Session 55, Part 5), on a phone and in the operator's right-click menu: the
 * picture as its slide shows it on the screens, beyond its own look (a22-x95nits): the part its slide keeps of it (a
 * deck's cropped picture), flipped and turned in quarter turns as its slide draws it (render/SlideView.tsx
 * frameStyle: flipped, then turned about its middle; Turn page right turns a PDF page's picture so), and then the
 * part a page cropped with Crop page… keeps. Exact where the picture fills its frame, as a PDF page's picture and a
 * deck's cropped picture do. A turn other than a quarter one is left out, as before, and a page crop with it.
 */

/** Within this much of an edge, a part reaches it. */
const NEAR = 1e-9;

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
export function onSlideOf(element: MediaElement, slide: RenderSlide): OnSlide | null {
  const degrees = (((element.rotation ?? 0) % 360) + 360) % 360;
  const turn: Turn = degrees === 90 ? 90 : degrees === 180 ? 180 : degrees === 270 ? 270 : 0;
  const quarter = degrees === turn;
  const c = element.crop;
  const crop =
    c && c.width > 0 && c.height > 0 && !whole({ x: c.x, y: c.y, w: c.width, h: c.height })
      ? { x: c.x, y: c.y, w: c.width, h: c.height }
      : undefined;
  const part = quarter && slide.pageCrop ? partKept(element, slide) : undefined;
  const on: OnSlide = {
    ...(crop ? { crop } : {}),
    ...(element.flipX ? { flipX: true } : {}),
    ...(element.flipY ? { flipY: true } : {}),
    ...(turn !== 0 ? { turn } : {}),
    ...(part ? { part } : {}),
  };
  return Object.keys(on).length > 0 ? on : null;
}

/** The picture's look with what its slide does to it after: the picture as the screens show it on that slide. */
export function lookOnSlide(look: PictureLook | null, on: OnSlide | null): PictureLook | null {
  if (!on) return look;
  let next = look ?? PLAIN;
  if (on.crop) next = { ...next, crop: inside(next.crop ?? FULL_CROP, on.crop) };
  if (on.flipX) next = flipAcross(next);
  if (on.flipY) next = flipUpDown(next);
  for (let t = 0; t < (on.turn ?? 0); t += 90) next = turnClockwise(next);
  if (on.part) next = { ...next, crop: inside(next.crop ?? FULL_CROP, on.part) };
  return next;
}

const whole = (c: CropRect): boolean =>
  c.x <= NEAR && c.y <= NEAR && c.x + c.w >= 1 - NEAR && c.y + c.h >= 1 - NEAR;

/** A part of a part: `part`, in fractions of `of`, in fractions of the whole. */
const inside = (of: CropRect, part: CropRect): CropRect => ({
  x: of.x + part.x * of.w,
  y: of.y + part.y * of.h,
  w: part.w * of.w,
  h: part.h * of.h,
});

/**
 * The part of the picture's frame, as the screens draw it (a quarter turn stands it on end about its middle), that
 * a page cropped with Crop page… keeps, in fractions of it; none where it keeps all of it, or none of it.
 */
function partKept(element: MediaElement, slide: RenderSlide): CropRect | undefined {
  const crop = slide.pageCrop;
  if (!crop) return undefined;
  const f = element.frame;
  const degrees = (((element.rotation ?? 0) % 360) + 360) % 360;
  const onEnd = degrees === 90 || degrees === 270;
  const width = onEnd ? f.height : f.width;
  const height = onEnd ? f.width : f.height;
  if (width <= 0 || height <= 0) return undefined;
  const x = f.x + (f.width - width) / 2;
  const y = f.y + (f.height - height) / 2;
  // What the slide shows of the page: the crop, from where it starts, as big as the slide.
  const left = Math.max(x, crop.x);
  const top = Math.max(y, crop.y);
  const right = Math.min(x + width, crop.x + slide.width);
  const bottom = Math.min(y + height, crop.y + slide.height);
  if (right <= left || bottom <= top) return undefined;
  const part = {
    x: (left - x) / width,
    y: (top - y) / height,
    w: (right - left) / width,
    h: (bottom - top) / height,
  };
  return whole(part) ? undefined : part;
}
