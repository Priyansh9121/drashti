import type { Rect } from '../../../shared/model';
import type { CropRect } from '../../../shared/picture-look';

/*
 * The crop's box (the Picture editor's, Session 55, Part 5), shared since alpha.21 with the slide editor's Crop picture
 * and Make a slide… (the owner's "physical way to crop, like in a photo"): the part kept is dragged, never typed. A
 * slide's own crop is kept in the picture's own shares (before the element's flips: SlideView draws the flips over
 * the cropped picture), so the box, drawn over the picture as the slide shows it, works in shares as it is seen.
 */

/** The slide's crop (its picture's own shares) as the box shows it over the picture as the slide draws it. */
export function shownCrop(crop: Rect | undefined, flipX = false, flipY = false): CropRect {
  const c = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: flipX ? 1 - c.x - c.width : c.x,
    y: flipY ? 1 - c.y - c.height : c.y,
    w: c.width,
    h: c.height,
  };
}

/** To a ten-thousandth of the picture. */
const kept = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * The box's part as the slide keeps it: back in the picture's own shares, to a ten-thousandth (a sum of hundredths
 * from the arrows is kept as the hundredths it is); none for the whole picture.
 */
export function keptCrop(shown: CropRect, flipX = false, flipY = false): Rect | undefined {
  const width = kept(shown.w);
  const height = kept(shown.h);
  const x = kept(flipX ? 1 - shown.x - shown.w : shown.x);
  const y = kept(flipY ? 1 - shown.y - shown.h : shown.y);
  if (x <= 0 && y <= 0 && width >= 1 && height >= 1) return undefined;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(width, 1 - Math.max(0, x)),
    height: Math.min(height, 1 - Math.max(0, y)),
  };
}

/** A share as whole percent. */
const percent = (n: number) => `${String(Math.max(0, Math.round(n * 100)))}%`;

/** What the box takes off each side, in whole percent: a read-out only, never asked for. */
export function cropReadout(shown: CropRect): string {
  return `Taken off: left ${percent(shown.x)}, top ${percent(shown.y)}, right ${percent(1 - shown.x - shown.w)}, bottom ${percent(1 - shown.y - shown.h)}`;
}
