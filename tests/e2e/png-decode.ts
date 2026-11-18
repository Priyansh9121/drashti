import { inflateSync } from 'node:zlib';

/*
 * A page's screenshot decoded here, in the test, never in the page (Session 59, X17): decoding a whole 1920 x 1080
 * screenshot inside an output's page (createImageBitmap, then getImageData's read back from the graphics chip) held
 * that page's main thread on CI's busy Mac until Drashti's watchdog, hearing nothing for 6 s, stopped it ("Target
 * crashed": deck-native-outputs.spec.ts, its dump with no exception, S58 and S59). A test that reads a screen must not
 * load it. Chromium's screenshots are 8-bit RGB or RGBA PNGs, not interlaced: that is all this reads.
 */

export interface Decoded {
  width: number;
  height: number;
  /** Red, green, blue and alpha for each pixel, row by row. */
  rgba: Uint8Array;
}

/** The PNG's pixels. */
export function decodePng(png: Buffer): Decoded {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0)
        throw new Error(`a PNG this reader does not read (depth ${String(depth)}, colour ${String(colour)})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[from + x] ?? 0;
      const left = x >= channels ? (rows[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= channels && y > 0 ? (rows[(y - 1) * stride + x - channels] ?? 0) : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      rows[y * stride + x] = (v + add) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    rgba[j] = rows[i] ?? 0;
    rgba[j + 1] = rows[i + 1] ?? 0;
    rgba[j + 2] = rows[i + 2] ?? 0;
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}
