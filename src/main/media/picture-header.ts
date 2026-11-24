import { open } from 'node:fs/promises';
import type { PixelSize } from '../../shared/picture-look';

export interface PictureHeader {
  /** In the orientation Chromium draws, including EXIF's quarter turn. */
  size: PixelSize;
  type: 'jpg' | 'png';
  /** Animation is always retained; a one-frame display job never sees it. */
  animated: boolean;
}

/** Only metadata is read on Main. Compressed picture data is decoded by the hidden worker. */
const HEADER_BYTES = 2 * 1024 * 1024;
const valid = (width: number, height: number) =>
  width >= 1 && height >= 1 && width <= 100_000 && height <= 100_000;
const result = (
  width: number,
  height: number,
  type: 'jpg' | 'png',
  animated = false,
): PictureHeader | null => (valid(width, height) ? { size: { width, height }, type, animated } : null);

function exifTurn(b: Buffer): boolean {
  if (b.length < 14 || b.toString('ascii', 0, 6) !== 'Exif\0\0') return false;
  const t = b.subarray(6);
  const little = t.toString('ascii', 0, 2) === 'II';
  if (!little && t.toString('ascii', 0, 2) !== 'MM') return false;
  const u16 = (p: number) => (little ? t.readUInt16LE(p) : t.readUInt16BE(p));
  const u32 = (p: number) => (little ? t.readUInt32LE(p) : t.readUInt32BE(p));
  if (u16(2) !== 42) return false;
  const at = u32(4);
  if (at + 2 > t.length) return false;
  const count = Math.min(u16(at), 256);
  for (let i = 0; i < count; i++) {
    const p = at + 2 + i * 12;
    if (p + 12 > t.length) break;
    if (u16(p) === 0x0112 && u16(p + 2) === 3 && u32(p + 4) === 1) return u16(p + 8) >= 5 && u16(p + 8) <= 8;
  }
  return false;
}

function jpegHeader(b: Buffer): PictureHeader | null {
  let width = 0;
  let height = 0;
  let turned = false;
  for (let p = 2, n = 0; p + 4 <= b.length && n < 512; n++) {
    if (b[p] !== 255) break;
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === undefined) break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (p + 2 > b.length) break;
    const length = b.readUInt16BE(p);
    if (length < 2 || p + length > b.length) break;
    if (marker === 0xe1) turned ||= exifTurn(b.subarray(p + 2, p + length));
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      height = b.readUInt16BE(p + 3);
      width = b.readUInt16BE(p + 5);
    }
    p += length;
  }
  return turned ? result(height, width, 'jpg') : result(width, height, 'jpg');
}

function avifHeader(b: Buffer): PictureHeader | null {
  const brands = new Set<string>();
  let width = 0;
  let height = 0;
  const rotation = { turned: false };
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 6) return;
    for (let p = start, n = 0; p + 8 <= end && n < 256; n++) {
      let size = b.readUInt32BE(p);
      let head = 8;
      if (size === 1) {
        if (p + 16 > end) return;
        const large = b.readBigUInt64BE(p + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(large);
        head = 16;
      } else if (size === 0) size = end - p;
      if (size < head || p + size > end) return;
      const type = b.toString('ascii', p + 4, p + 8);
      const at = p + head;
      if (type === 'ftyp') {
        for (let q = at; q + 4 <= p + size; q += 4) {
          if (q === at + 4) continue;
          const brand = b.toString('ascii', q, q + 4);
          brands.add(brand);
        }
      } else if (type === 'ispe' && at + 12 <= p + size) {
        const w = b.readUInt32BE(at + 4);
        const h = b.readUInt32BE(at + 8);
        if (valid(w, h) && w * h > width * height) {
          width = w;
          height = h;
        }
      } else if (type === 'irot' && at < p + size) rotation.turned = ((b[at] ?? 0) & 1) === 1;
      else if (['meta', 'iprp', 'ipco'].includes(type))
        walk(at + (type === 'meta' ? 4 : 0), p + size, depth + 1);
      p += size;
    }
  };
  walk(0, b.length, 0);
  if (!brands.has('avif') && !brands.has('avis')) return null;
  return rotation.turned
    ? result(height, width, 'png', brands.has('avis'))
    : result(width, height, 'png', brands.has('avis'));
}

/** Read still dimensions/animation from bounded header bytes; malformed or incomplete metadata is unknown. */
export function pictureHeader(bytes: Uint8Array): PictureHeader | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, HEADER_BYTES));
  try {
    if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return jpegHeader(b);
    if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
      const width = b.readUInt32BE(16);
      const height = b.readUInt32BE(20);
      for (let p = 8, n = 0; p + 8 <= b.length && n < 256; n++) {
        const length = b.readUInt32BE(p);
        const type = b.toString('ascii', p + 4, p + 8);
        if (type === 'acTL') return result(width, height, 'png', true);
        if (type === 'IDAT') return result(width, height, 'png');
        p += length + 12;
      }
      return null;
    }
    if (b.length >= 13 && /^GIF8[79]a$/u.test(b.toString('ascii', 0, 6)))
      return result(b.readUInt16LE(6), b.readUInt16LE(8), 'png', true);
    if (b.length >= 26 && b.toString('ascii', 0, 2) === 'BM') {
      return b.readUInt32LE(14) === 12
        ? result(b.readUInt16LE(18), b.readUInt16LE(20), 'png')
        : result(Math.abs(b.readInt32LE(18)), Math.abs(b.readInt32LE(22)), 'png');
    }
    if (b.length >= 25 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X' && b.length >= 30)
        return result(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1, 'png', ((b[20] ?? 0) & 2) !== 0);
      if (kind === 'VP8 ' && b.length >= 30 && b.toString('hex', 23, 26) === '9d012a')
        return result(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff, 'png');
      if (kind === 'VP8L' && b[20] === 0x2f) {
        const bits = b.readUInt32LE(21);
        return result((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'png');
      }
    }
    if (b.length >= 22 && b.readUInt32LE(0) === 0x00010000) {
      const count = Math.min(b.readUInt16LE(4), 256);
      let width = 0;
      let height = 0;
      for (let p = 6, n = 0; n < count && p + 16 <= b.length; n++, p += 16) {
        const w = b[p] ?? 0;
        width = Math.max(width, w === 0 ? 256 : w);
        const h = b[p + 1] ?? 0;
        height = Math.max(height, h === 0 ? 256 : h);
      }
      return result(width, height, 'png');
    }
    if (b.length >= 16 && b.toString('ascii', 4, 8) === 'ftyp') return avifHeader(b);
  } catch {
    // A malformed offset/length is unknown, never permission to flatten a possible animation.
  }
  return null;
}

export async function readPictureHeader(path: string): Promise<PictureHeader | null> {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(Math.min((await file.stat()).size, HEADER_BYTES));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return pictureHeader(bytes.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}
