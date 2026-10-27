import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/*
 * A picture's size and what it is, from its first bytes (Session 54, D1), so a phone that asks for a picture at
 * least as wide as the file itself is given the file, and a picture that may be see-through stays so when it is
 * made smaller. Nothing is decoded and the file is never read whole: a few small reads where its headers say.
 * A photo turned by its EXIF orientation is measured as it is shown (turned), as the screens and FFmpeg show it.
 */

export type PictureFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp';

export interface PictureInfo {
  format: PictureFormat;
  /** As shown: a photo on its side (EXIF orientation 5 to 8) has its width and height changed round. */
  width: number;
  height: number;
  /** It may have see-through parts: an alpha channel or a transparent colour. */
  alpha: boolean;
}

/** What every phone's and tablet's browser shows as it is (Safari since iOS 14 for WebP). */
export const BROWSER_PICTURES: ReadonlySet<PictureFormat> = new Set(['jpeg', 'png', 'gif', 'webp']);

export const PICTURE_TYPES: Record<PictureFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** No picture Drashti shows is wider or taller than this; a header that says so is not believed. */
const MAX_SIDE = 65_535;
/** How many JPEG segments or PNG chunks are walked before giving up (a damaged file loops no further). */
const MAX_STEPS = 512;

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

const sized = (info: PictureInfo): PictureInfo | null =>
  info.width >= 1 && info.height >= 1 && info.width <= MAX_SIDE && info.height <= MAX_SIDE ? info : null;

/** A picture's format, size as shown and see-through parts, or null when it is not a picture Drashti knows. */
export async function readPictureInfo(path: string): Promise<PictureInfo | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const head = await readAt(fh, 0, 32);
    if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) return await jpegInfo(fh);
    if (head.length >= 26 && head.readUInt32BE(0) === 0x89504e47 && head.readUInt32BE(4) === 0x0d0a1a0a)
      return await pngInfo(fh, head);
    if (head.length >= 10 && head.toString('latin1', 0, 4) === 'GIF8')
      return sized({ format: 'gif', width: head.readUInt16LE(6), height: head.readUInt16LE(8), alpha: true });
    if (
      head.length >= 30 &&
      head.toString('latin1', 0, 4) === 'RIFF' &&
      head.toString('latin1', 8, 12) === 'WEBP'
    )
      return webpInfo(head);
    if (head.length >= 26 && head.toString('latin1', 0, 2) === 'BM') return bmpInfo(head);
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

// ---- JPEG ----------------------------------------------------------------------------------------

/** A frame header's marker (SOF0 to SOF15, without DHT, JPG and DAC, which share the range). */
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

async function jpegInfo(fh: FileHandle): Promise<PictureInfo | null> {
  let at = 2;
  let orientation = 1;
  for (let step = 0; step < MAX_STEPS; step++) {
    const m = await readAt(fh, at, 4);
    if (m.length < 2 || m[0] !== 0xff) return null;
    const marker = m[1] ?? 0;
    // Fill bytes, and markers that stand alone (no length).
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // The picture's data or its end, and no frame header before it.
    if (marker === 0xd9 || marker === 0xda || m.length < 4) return null;
    const length = m.readUInt16BE(2);
    if (length < 2) return null;
    if (isFrame(marker)) {
      const f = await readAt(fh, at + 4, 5);
      if (f.length < 5) return null;
      const height = f.readUInt16BE(1);
      const width = f.readUInt16BE(3);
      const turned = orientation >= 5 && orientation <= 8;
      return sized({
        format: 'jpeg',
        width: turned ? height : width,
        height: turned ? width : height,
        alpha: false,
      });
    }
    // APP1: the photo's EXIF, where its orientation is.
    if (marker === 0xe1) orientation = exifOrientation(await readAt(fh, at + 4, length - 2)) ?? orientation;
    at += 2 + length;
  }
  return null;
}

/** The orientation (1 to 8) an APP1 segment's EXIF gives its photo, or null when it gives none. */
export function exifOrientation(segment: Buffer): number | null {
  if (segment.length < 14 || segment.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = segment.subarray(6);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    // Orientation, a SHORT.
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

// ---- PNG -----------------------------------------------------------------------------------------

async function pngInfo(fh: FileHandle, head: Buffer): Promise<PictureInfo | null> {
  if (head.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  // Grey with alpha, or colour with alpha; otherwise a transparent colour (tRNS) before the picture's data.
  const colourType = head[25] ?? 0;
  let alpha = colourType === 4 || colourType === 6;
  let at = 8;
  for (let step = 0; !alpha && step < MAX_STEPS; step++) {
    const chunk = await readAt(fh, at, 8);
    if (chunk.length < 8) break;
    const type = chunk.toString('latin1', 4, 8);
    if (type === 'tRNS') alpha = true;
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + chunk.readUInt32BE(0);
  }
  return sized({ format: 'png', width, height, alpha });
}

// ---- WebP and BMP --------------------------------------------------------------------------------

function webpInfo(head: Buffer): PictureInfo | null {
  const chunk = head.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // A lossy picture's key frame: its start code, then 14-bit width and height.
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return sized({
      format: 'webp',
      width: head.readUInt16LE(26) & 0x3fff,
      height: head.readUInt16LE(28) & 0x3fff,
      alpha: false,
    });
  }
  if (chunk === 'VP8L') {
    if (head[20] !== 0x2f) return null;
    const bits = head.readUInt32LE(21);
    return sized({
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    });
  }
  if (chunk === 'VP8X') {
    const flags = head[20] ?? 0;
    return sized({
      format: 'webp',
      width: head.readUIntLE(24, 3) + 1,
      height: head.readUIntLE(27, 3) + 1,
      alpha: (flags & 0x10) !== 0,
    });
  }
  return null;
}

function bmpInfo(head: Buffer): PictureInfo | null {
  const header = head.readUInt32LE(14);
  // The oldest header (OS/2's, 12 bytes) has 16-bit sizes; every later one 32-bit, the height negative when the
  // rows run top down.
  if (header === 12)
    return sized({
      format: 'bmp',
      width: head.readUInt16LE(18),
      height: head.readUInt16LE(20),
      alpha: false,
    });
  return sized({
    format: 'bmp',
    width: Math.abs(head.readInt32LE(18)),
    height: Math.abs(head.readInt32LE(22)),
    alpha: false,
  });
}
