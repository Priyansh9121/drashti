import type { PictureLook, PixelSize } from './picture-look';
import { shownSize, ZOOM } from './picture-look';

/** A stream still has a finite display demand when no audience output is configured. */
export const DEFAULT_DISPLAY_SIZE: Readonly<PixelSize> = { width: 1920, height: 1080 };

const validSize = (s: PixelSize): boolean =>
  Number.isFinite(s.width) && Number.isFinite(s.height) && s.width >= 1 && s.height >= 1;

/**
 * The source pixels every configured physical display needs. A cropped/turned picture keeps the density of
 * its visible part; differently shaped displays each count. Null means the original is already no larger.
 * Cover is conservative for an item used in several places; a known contain-only use can ask for contain.
 */
export function displayPictureSize(
  picture: PixelSize,
  targets: readonly PixelSize[],
  look: PictureLook | null = null,
  fit: 'contain' | 'cover' = 'cover',
): PixelSize | null {
  if (!validSize(picture)) return null;
  const visible = shownSize(look, picture);
  if (!validSize(visible)) return null;
  const boxes = targets.filter(validSize);
  if (boxes.length === 0) boxes.push(DEFAULT_DISPLAY_SIZE);
  const requestedZoom = look?.zoom ?? 1;
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, Number.isFinite(requestedZoom) ? requestedZoom : 1));
  const scale = Math.min(
    1,
    Math.max(
      ...boxes.map(
        (box) =>
          (fit === 'cover'
            ? Math.max(box.width / visible.width, box.height / visible.height)
            : Math.min(box.width / visible.width, box.height / visible.height)) * zoom,
      ),
    ),
  );
  if (scale >= 1) return null;
  // Round up to preserve the requested density, allowing only floating-point multiplication's last bit.
  const size = {
    width: Math.max(1, Math.ceil(picture.width * scale - 1e-7)),
    height: Math.max(1, Math.ceil(picture.height * scale - 1e-7)),
  };
  return size.width === picture.width && size.height === picture.height ? null : size;
}
