import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { exifOrientation, readPictureInfo } from './picture-info';

/*
 * A picture's size and kind from its first bytes (Session 54, D1): headers made here, byte by byte, never a real
 * photo. A photo turned by its EXIF orientation is measured as it is shown.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-picture-info-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function infoOf(bytes: Buffer) {
  const file = join(dir, `picture-${String(n++)}`);
  writeFileSync(file, bytes);
  return readPictureInfo(file);
}

const u16be = (v: number) => Buffer.from([(v >> 8) & 0xff, v & 0xff]);

/** An APP1 segment with an EXIF orientation, in either byte order. */
function exif(orientation: number, order: 'II' | 'MM' = 'II'): Buffer {
  const tiff = Buffer.alloc(26);
  const little = order === 'II';
  tiff.write(order, 0, 'latin1');
  const w16 = (v: number, at: number) => (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const w32 = (v: number, at: number) => (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  w16(42, 2);
  w32(8, 4);
  w16(2, 8);
  // A tag before it (the camera's make), then the orientation, a SHORT.
  w16(0x010f, 10);
  w16(2, 12);
  w32(4, 14);
  w32(0, 18);
  const entry = Buffer.alloc(12);
  if (little) {
    entry.writeUInt16LE(0x0112, 0);
    entry.writeUInt16LE(3, 2);
    entry.writeUInt32LE(1, 4);
    entry.writeUInt16LE(orientation, 8);
  } else {
    entry.writeUInt16BE(0x0112, 0);
    entry.writeUInt16BE(3, 2);
    entry.writeUInt32BE(1, 4);
    entry.writeUInt16BE(orientation, 8);
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff.subarray(0, 22), entry]);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(payload.length + 2), payload]);
}

/** A JPEG's headers: its segments, then a frame header (SOF) of this size, and the picture's data. */
function jpeg(width: number, height: number, segments: Buffer[] = [], frame = 0xc0): Buffer {
  const sof = Buffer.concat([
    Buffer.from([0xff, frame]),
    u16be(17),
    Buffer.from([8]),
    u16be(height),
    u16be(width),
    Buffer.alloc(10),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    sof,
    Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9]),
  ]);
}

/** A PNG's signature, IHDR, and the chunks given before its data. */
function png(width: number, height: number, colourType: number, chunks: string[] = []): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = colourType;
  const chunk = (type: string, length: number) => {
    const c = Buffer.alloc(12 + length);
    c.writeUInt32BE(length, 0);
    c.write(type, 4, 'latin1');
    return c;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    ...chunks.map((type) => chunk(type, type === 'pHYs' ? 9 : 3)),
    chunk('IDAT', 10),
    chunk('IEND', 0),
  ]);
}

function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', fill: (b: Buffer) => void): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(chunk, 12, 'latin1');
  b.writeUInt32LE(20, 16);
  fill(b);
  return b;
}

describe('a picture’s size and kind from its headers (Session 54, D1)', () => {
  it('reads a JPEG’s frame past its other segments, turned by its EXIF orientation', async () => {
    const icc = Buffer.concat([Buffer.from([0xff, 0xe2]), u16be(402), Buffer.alloc(400)]);
    expect(await infoOf(jpeg(4000, 3000, [icc]))).toEqual({
      format: 'jpeg',
      width: 4000,
      height: 3000,
      alpha: false,
    });
    // On its side (6: turned a quarter clockwise; 8 the other way; 5 and 7 mirrored too): shown 3000 wide.
    for (const o of [5, 6, 7, 8])
      expect(await infoOf(jpeg(4000, 3000, [exif(o), icc])), String(o)).toMatchObject({
        width: 3000,
        height: 4000,
      });
    for (const o of [1, 2, 3, 4])
      expect(await infoOf(jpeg(4000, 3000, [exif(o, 'MM')])), String(o)).toMatchObject({
        width: 4000,
        height: 3000,
      });
    // A progressive JPEG's frame header (SOF2) too, and fill bytes before a marker.
    expect(await infoOf(jpeg(800, 600, [Buffer.from([0xff])], 0xc2))).toMatchObject({
      width: 800,
      height: 600,
    });
    // Its Huffman tables (C4) are not its frame.
    const dht = Buffer.concat([Buffer.from([0xff, 0xc4]), u16be(4), Buffer.alloc(2)]);
    expect(await infoOf(jpeg(640, 480, [dht]))).toMatchObject({ width: 640, height: 480 });
  });

  it('reads the orientation only from an EXIF segment', () => {
    expect(exifOrientation(exif(6).subarray(4))).toBe(6);
    expect(exifOrientation(exif(3, 'MM').subarray(4))).toBe(3);
    expect(exifOrientation(Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'))).toBeNull();
    expect(exifOrientation(exif(9).subarray(4))).toBeNull();
  });

  it('says whether a PNG may be see-through: an alpha channel or a transparent colour', async () => {
    expect(await infoOf(png(1920, 1080, 2))).toEqual({
      format: 'png',
      width: 1920,
      height: 1080,
      alpha: false,
    });
    expect(await infoOf(png(1920, 1080, 6))).toMatchObject({ alpha: true });
    expect(await infoOf(png(1920, 1080, 4))).toMatchObject({ alpha: true });
    expect(await infoOf(png(640, 360, 3, ['pHYs', 'tRNS']))).toMatchObject({ width: 640, alpha: true });
    expect(await infoOf(png(640, 360, 3, ['pHYs']))).toMatchObject({ alpha: false });
  });

  it('reads a GIF, the three kinds of WebP and a BMP', async () => {
    const gif = Buffer.alloc(13);
    gif.write('GIF89a', 0, 'latin1');
    gif.writeUInt16LE(500, 6);
    gif.writeUInt16LE(281, 8);
    expect(await infoOf(gif)).toEqual({ format: 'gif', width: 500, height: 281, alpha: true });
    const lossy = webp('VP8 ', (b) => {
      b.set([0x9d, 0x01, 0x2a], 23);
      b.writeUInt16LE(1600, 26);
      b.writeUInt16LE(900, 28);
    });
    expect(await infoOf(lossy)).toEqual({ format: 'webp', width: 1600, height: 900, alpha: false });
    const lossless = webp('VP8L', (b) => {
      b[20] = 0x2f;
      b.writeUInt32LE((1023 | (575 << 14) | (1 << 28)) >>> 0, 21);
    });
    expect(await infoOf(lossless)).toEqual({ format: 'webp', width: 1024, height: 576, alpha: true });
    const extended = webp('VP8X', (b) => {
      b[20] = 0x10;
      b.writeUIntLE(3839, 24, 3);
      b.writeUIntLE(2159, 27, 3);
    });
    expect(await infoOf(extended)).toEqual({ format: 'webp', width: 3840, height: 2160, alpha: true });
    const bmp = Buffer.alloc(54);
    bmp.write('BM', 0, 'latin1');
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(300, 18);
    bmp.writeInt32LE(-200, 22);
    expect(await infoOf(bmp)).toEqual({ format: 'bmp', width: 300, height: 200, alpha: false });
  });

  it('knows nothing of what is not a picture, a header cut short, or a size past belief', async () => {
    expect(await infoOf(Buffer.from('Placeholder words, not a picture at all.'))).toBeNull();
    expect(await infoOf(jpeg(4000, 3000).subarray(0, 8))).toBeNull();
    // Its data before any frame header.
    expect(await infoOf(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(await infoOf(png(0, 1080, 2))).toBeNull();
    expect(await infoOf(png(70_000, 1080, 2))).toBeNull();
    expect(await readPictureInfo(join(dir, 'not-there.png'))).toBeNull();
  });
});
