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
  void crop;
  void flipX;
  void flipY;
  throw new Error('not yet');
}

/**
 * The box's part as the slide keeps it: back in the picture's own shares, to a ten-thousandth (a sum of hundredths
 * from the arrows is kept as the hundredths it is); none for the whole picture.
 */
export function keptCrop(shown: CropRect, flipX = false, flipY = false): Rect | undefined {
  void shown;
  void flipX;
  void flipY;
  throw new Error('not yet');
}

/** What the box takes off each side, in whole percent: a read-out only, never asked for. */
export function cropReadout(shown: CropRect): string {
  void shown;
  throw new Error('not yet');
}
