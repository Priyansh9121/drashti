import { deflateSync, inflateSync } from 'node:zlib';
import type { QrPlan } from '../../shared/qr-picture';
import { qrScale } from '../../shared/qr-picture';

/*
 * The QR code's picture in pixels (Q60-28): the plan (shared/qr-picture.ts) drawn whole-pixel crisp, white with its
 * dark modules and the logo fitted in its box, and written as a PNG; and the PNG reader for the logo's kept copy. Pure
 * Node (zlib only), so the QR worker runs it off Main's thread and the unit tests run it as it is.
 */

/** Pixels, 8 bits a channel: 1 (grey), 3 (RGB) or 4 (RGBA, straight alpha) channels. */
export interface Pixels {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Uint8Array;
}

/** The largest logo copy Drashti keeps or reads, on its longer side. */
export const QR_LOGO_MAX_SIDE = 1024;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** PNG colour types by channels: grey, RGB, RGBA. */
const COLOUR_TYPE: Record<Pixels['channels'], number> = { 1: 0, 3: 2, 4: 6 };

/** Pixels as a PNG: 8 bits a channel, no interlace, every row unfiltered. */
export function writePng(img: Pixels): Uint8Array {
  const row = img.width * img.channels;
  const raw = Buffer.alloc(img.height * (row + 1));
  for (let y = 0; y < img.height; y++) {
    // Each row starts with its filter (0, none), then its pixels.
    raw[y * (row + 1)] = 0;
    raw.set(img.data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header[8] = 8;
  header[9] = COLOUR_TYPE[img.channels];
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The channels of each PNG colour type Drashti reads (8 bits a channel): grey, RGB, grey and alpha, RGBA. */
const CHANNELS_OF: Partial<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** A PNG's size and kind from its header, or null for what is not one Drashti reads. */
export function pngHeader(bytes: Uint8Array): { width: number; height: number; channels: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIGNATURE) || b.toString('latin1', 12, 16) !== 'IHDR')
    return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const channels = CHANNELS_OF[b[25] ?? -1];
  // 8 bits a channel, the usual compression and filters, no interlace.
  if (b[24] !== 8 || channels === undefined || b[26] !== 0 || b[27] !== 0 || b[28] !== 0) return null;
  if (width < 1 || height < 1 || width > QR_LOGO_MAX_SIDE * 4 || height > QR_LOGO_MAX_SIDE * 4) return null;
  return { width, height, channels };
}

/** A PNG's pixels as RGBA (8 bits a channel, straight alpha), or null for one it cannot read. */
export function readPng(bytes: Uint8Array): Pixels | null {
  const header = pngHeader(bytes);
  if (!header) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { width, height, channels } = header;
  const parts: Buffer[] = [];
  let at = 8;
  let ended = false;
  while (at + 12 <= b.length) {
    const length = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > b.length) return null;
    if (type === 'IDAT') parts.push(b.subarray(at + 8, at + 8 + length));
    at += 12 + length;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || parts.length === 0) return null;
  const row = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(parts));
  } catch {
    return null;
  }
  if (raw.length < height * (row + 1)) return null;
  // Undo each row's filter (none, sub, up, average, Paeth), against the row above as already undone.
  const plain = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)];
    const from = y * (row + 1) + 1;
    for (let x = 0; x < row; x++) {
      const v = raw[from + x] ?? 0;
      const left = x >= channels ? (plain[y * row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (plain[(y - 1) * row + x] ?? 0) : 0;
      const ul = y > 0 && x >= channels ? (plain[(y - 1) * row + x - channels] ?? 0) : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
          break;
        }
        default:
          return null;
      }
      plain[y * row + x] = (v + predicted) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const o = i * 4;
    if (channels <= 2) {
      const v = plain[s] ?? 0;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = channels === 2 ? (plain[s + 1] ?? 255) : 255;
    } else {
      data[o] = plain[s] ?? 0;
      data[o + 1] = plain[s + 1] ?? 0;
      data[o + 2] = plain[s + 2] ?? 0;
      data[o + 3] = channels === 4 ? (plain[s + 3] ?? 255) : 255;
    }
  }
  return { width, height, channels: 4, data };
}

/**
 * The logo (RGBA) fitted inside a box of `box` pixels square, its shape kept, in the middle: premultiplied RGBA of the
 * box, each pixel the average of the logo's pixels under it (or the blend of the nearest four, where the logo is
 * smaller than the box).
 */
function fitted(logo: Pixels, box: number): Float32Array {
  const out = new Float32Array(box * box * 4);
  const scale = Math.min(box / logo.width, box / logo.height);
  const w = Math.max(1, Math.round(logo.width * scale));
  const h = Math.max(1, Math.round(logo.height * scale));
  const x0 = Math.floor((box - w) / 2);
  const y0 = Math.floor((box - h) / 2);
  const src = (x: number, y: number, c: number): number => {
    const at = (y * logo.width + x) * 4;
    const a = (logo.data[at + 3] ?? 0) / 255;
    return c === 3 ? a : ((logo.data[at + c] ?? 0) / 255) * a;
  };
  const sx = logo.width / w;
  const sy = logo.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * box + x0 + x) * 4;
      if (sx >= 1 && sy >= 1) {
        // Smaller: the average of the logo's pixels this one covers, part pixels in part.
        const left = x * sx;
        const right = left + sx;
        const top = y * sy;
        const bottom = top + sy;
        let total = 0;
        const sum = [0, 0, 0, 0];
        for (let yy = Math.floor(top); yy < Math.min(logo.height, Math.ceil(bottom)); yy++) {
          const wy = Math.min(bottom, yy + 1) - Math.max(top, yy);
          for (let xx = Math.floor(left); xx < Math.min(logo.width, Math.ceil(right)); xx++) {
            const weight = (Math.min(right, xx + 1) - Math.max(left, xx)) * wy;
            total += weight;
            for (let c = 0; c < 4; c++) sum[c] = (sum[c] ?? 0) + src(xx, yy, c) * weight;
          }
        }
        for (let c = 0; c < 4; c++) out[o + c] = total > 0 ? (sum[c] ?? 0) / total : 0;
      } else {
        // Larger: the blend of the four nearest.
        const fx = Math.min(logo.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const fy = Math.min(logo.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const xa = Math.floor(fx);
        const ya = Math.floor(fy);
        const xb = Math.min(logo.width - 1, xa + 1);
        const yb = Math.min(logo.height - 1, ya + 1);
        const tx = fx - xa;
        const ty = fy - ya;
        for (let c = 0; c < 4; c++)
          out[o + c] =
            (src(xa, ya, c) * (1 - tx) + src(xb, ya, c) * tx) * (1 - ty) +
            (src(xa, yb, c) * (1 - tx) + src(xb, yb, c) * tx) * ty;
      }
    }
  return out;
}

/**
 * The code in pixels, about `about` square (whole pixels a module): white, black modules and its quiet border; with a
 * logo, the logo fitted in its box over the white patch, RGB; without one, grey.
 */
export function qrRaster(plan: QrPlan, about: number, logo: Pixels | null): Pixels {
  const { scale, side } = qrScale(plan, about);
  const box = plan.logo && logo ? plan.logo : null;
  const channels = box ? 3 : 1;
  const data = new Uint8Array(side * side * channels).fill(255);
  plan.dark.forEach((row, my) => {
    row.forEach((dark, mx) => {
      if (!dark) return;
      const x0 = (mx + plan.border) * scale;
      const y0 = (my + plan.border) * scale;
      for (let y = y0; y < y0 + scale; y++)
        data.fill(0, (y * side + x0) * channels, (y * side + x0 + scale) * channels);
    });
  });
  if (box && logo) {
    const px = box.side * scale;
    const left = (box.at + plan.border) * scale;
    const art = fitted(logo, px);
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const s = (y * px + x) * 4;
        const a = art[s + 3] ?? 0;
        if (a <= 0) continue;
        const o = ((left + y) * side + left + x) * 3;
        // Over white: premultiplied colour plus white where the logo is clear.
        for (let c = 0; c < 3; c++) data[o + c] = Math.round(((art[s + c] ?? 0) + (1 - a)) * 255);
      }
  }
  return { width: side, height: side, channels, data };
}
