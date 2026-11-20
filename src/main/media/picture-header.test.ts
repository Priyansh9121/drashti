import { describe, expect, it } from 'vitest';
import { pictureHeader } from './picture-header';

const chunk = (name: string, data: Buffer) => {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(name, 4);
  data.copy(out, 8);
  return out;
};
const png = (animated = false) => {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(6144);
  h.writeUInt32BE(3456, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', h),
    ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
    chunk('IDAT', Buffer.from([0])),
  ]);
};
const box = (name: string, data: Buffer) => {
  const b = Buffer.alloc(data.length + 8);
  b.writeUInt32BE(b.length);
  b.write(name, 4);
  data.copy(b, 8);
  return b;
};

describe('still picture headers without decoding on Main', () => {
  it('reads PNG dimensions and retains alpha', () => {
    expect(pictureHeader(png())).toMatchObject({
      size: { width: 6144, height: 3456 },
      type: 'png',
      animated: false,
    });
  });
  it('never flattens an animated PNG or GIF', () => {
    expect(pictureHeader(png(true))?.animated).toBe(true);
    const gif = Buffer.alloc(13);
    gif.write('GIF89a');
    gif.writeUInt16LE(4000, 6);
    gif.writeUInt16LE(3000, 8);
    expect(pictureHeader(gif)?.animated).toBe(true);
  });
  it('reads a JPEG SOF without decoding its pixels', () => {
    const jpeg = Buffer.from([
      255, 216, 255, 192, 0, 17, 8, 13, 128, 24, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
    ]);
    expect(pictureHeader(jpeg)).toMatchObject({
      size: { width: 6144, height: 3456 },
      type: 'jpg',
      animated: false,
    });
  });
  it('reads WebP size and its explicit animation flag', () => {
    const webp = Buffer.alloc(30);
    webp.write('RIFF');
    webp.write('WEBPVP8X', 8);
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(5999, 24, 3);
    webp.writeUIntLE(3999, 27, 3);
    expect(pictureHeader(webp)).toMatchObject({
      size: { width: 6000, height: 4000 },
      type: 'png',
      animated: false,
    });
    webp[20] = 2;
    expect(pictureHeader(webp)?.animated).toBe(true);
  });
  it('keeps AVIF sequences animated and reads a still image spatial extent', () => {
    const extent = Buffer.alloc(12);
    extent.writeUInt32BE(6000, 4);
    extent.writeUInt32BE(4000, 8);
    const data = box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', box('ispe', extent)))]));
    expect(pictureHeader(Buffer.concat([box('ftyp', Buffer.from('avif\0\0\0\0avif')), data]))).toMatchObject({
      size: { width: 6000, height: 4000 },
      animated: false,
    });
    expect(pictureHeader(Buffer.concat([box('ftyp', Buffer.from('avis\0\0\0\0avif')), data]))?.animated).toBe(
      true,
    );
  });
  it('does not guess from unknown or truncated headers', () => {
    expect(pictureHeader(Buffer.from('placeholder'))).toBeNull();
    expect(pictureHeader(png().subarray(0, 20))).toBeNull();
  });
});
