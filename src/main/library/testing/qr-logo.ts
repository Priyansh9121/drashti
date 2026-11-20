import { writePng } from '../qr-raster';

/*
 * A generated placeholder logo for the QR code's tests (Q60-28): never the mandir's (the real logo reaches a mandir's
 * computer only through the private opening pack or the setup kit, never the repository). An orange disc with a deep
 * red middle on a clear background, its edges softened as a drawn logo's are.
 */

/** The placeholder's colours: its ring and its middle. */
export const PLACEHOLDER_LOGO_RING: readonly [number, number, number] = [224, 106, 27];
export const PLACEHOLDER_LOGO_MIDDLE: readonly [number, number, number] = [138, 28, 28];

/** How much of a pixel at `d` from the middle a disc of radius `r` covers (one pixel's soft edge). */
const cover = (d: number, r: number): number => Math.min(1, Math.max(0, r - d + 0.5));

/** The placeholder logo's pixels (RGBA, straight alpha), `width` by `height`. */
export function placeholderLogoPixels(width = 256, height = 256): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) * 0.45;
  const inner = outer * 0.38;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const disc = cover(d, outer);
      const middle = cover(d, inner);
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[at + c] = Math.round(
          (PLACEHOLDER_LOGO_MIDDLE[c] ?? 0) * middle + (PLACEHOLDER_LOGO_RING[c] ?? 0) * (1 - middle),
        );
      data[at + 3] = Math.round(255 * disc);
    }
  return data;
}

/** The placeholder logo as a PNG (8-bit RGBA), as the window keeps a chosen picture. */
export function placeholderLogoPng(width = 256, height = 256): Uint8Array {
  return writePng({ width, height, channels: 4, data: placeholderLogoPixels(width, height) });
}
