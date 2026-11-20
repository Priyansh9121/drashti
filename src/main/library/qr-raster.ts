import { deflateSync } from 'node:zlib';
import type { QrPlan } from '../../shared/qr-picture';
import { qrScale } from '../../shared/qr-picture';

/*
 * The QR code's picture in pixels (Q60-28): the plan (shared/qr-picture.ts) drawn whole-pixel crisp, white with its
 * dark modules and the logo in its box, and written as a PNG. Pure Node (zlib only), so the QR worker runs it off
 * Main's thread and the unit tests run it as it is. Red stand-in: no logo yet, and no PNG reader.
 */

/** Pixels, 8 bits a channel: 1 (grey), 3 (RGB) or 4 (RGBA, straight alpha) channels. */
export interface Pixels {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Uint8Array;
}

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

/** A PNG's pixels as RGBA (8 bits a channel, straight alpha), or null for one it cannot read. */
export function readPng(_bytes: Uint8Array): Pixels | null {
  return null;
}

/**
 * The code in pixels, about `about` square (whole pixels a module): white, black modules, its quiet border; RGB with a
 * logo, grey without.
 */
export function qrRaster(plan: QrPlan, about: number, _logo: Pixels | null): Pixels {
  const { scale, side } = qrScale(plan, about);
  const data = new Uint8Array(side * side).fill(255);
  plan.dark.forEach((row, my) => {
    row.forEach((dark, mx) => {
      if (!dark) return;
      const x0 = (mx + plan.border) * scale;
      const y0 = (my + plan.border) * scale;
      for (let y = y0; y < y0 + scale; y++) data.fill(0, y * side + x0, y * side + x0 + scale);
    });
  });
  return { width: side, height: side, channels: 1, data };
}
