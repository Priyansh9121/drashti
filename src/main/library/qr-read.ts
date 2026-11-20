import { decodeQR } from 'qr/decode.js';
import type { Pixels } from './qr-raster';

/*
 * Every QR code Drashti makes is read back before it is saved or put on a slide (Q60-28, the owner's acceptance of 20
 * Nov 2026; the reader is qr 0.7.2 by Paul Miller, MIT OR Apache-2.0, his "Yes, A" to Q60-33): the picture's own
 * pixels, as a phone's camera would see a perfect print of it.
 */

/** What a QR reader reads from these pixels, or null when it finds no code it can read. */
export function readQr(img: Pixels): string | null {
  const rgb =
    img.channels === 3
      ? img.data
      : (() => {
          // Grey or RGBA pixels as RGB (RGBA's alpha over white).
          const out = new Uint8Array(img.width * img.height * 3);
          for (let i = 0, o = 0; o < out.length; i += img.channels, o += 3) {
            if (img.channels === 1) {
              const v = img.data[i] ?? 255;
              out[o] = v;
              out[o + 1] = v;
              out[o + 2] = v;
            } else {
              const a = (img.data[i + 3] ?? 255) / 255;
              for (let c = 0; c < 3; c++)
                out[o + c] = Math.round((img.data[i + c] ?? 255) * a + 255 * (1 - a));
            }
          }
          return out;
        })();
  try {
    return decodeQR({ width: img.width, height: img.height, data: rgb }, { format: 'RGB' });
  } catch {
    return null;
  }
}
