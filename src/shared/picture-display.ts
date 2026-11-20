import type { PictureLook, PixelSize } from './picture-look';

/** A picture's display copy is bounded by the physical pixels its uses need, never upscaled. */
export function displayPictureSize(
  _picture: PixelSize,
  _targets: readonly PixelSize[],
  _look: PictureLook | null = null,
  _fit: 'contain' | 'cover' = 'cover',
): PixelSize | null {
  // Before display copies, every picture is drawn from its original.
  return null;
}
