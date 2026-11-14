import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CapturedPicture } from '../../shared/pdf-copy';
import { pngOf } from './png';

/*
 * A phone's picture of a deck's click made a PNG in the network's process (C18's review, LOW-2): a slice at a time,
 * each after its pace, which the server keeps while the hall screens move (slide-picture.ts whileScreensMove), so
 * on a two-core laptop the making never takes from the show's motion. Made-up pixels only.
 */

/** The PNG's size, and its rows as stored, each with its filter byte first. */
function rowsOf(png: Buffer): { width: number; height: number; rows: Buffer } {
  let at = 8;
  let width = 0;
  let height = 0;
  const stored: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    } else if (type === 'IDAT') stored.push(body);
    at += 12 + length;
  }
  return { width, height, rows: inflateSync(Buffer.concat(stored)) };
}

/** Made-up pixels, each row and column its own, in the order Main captured them. */
function pictureOf(width: number, height: number, order: 'bgra' | 'rgba' = 'bgra'): CapturedPicture {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      pixels[at] = x % 251;
      pixels[at + 1] = y % 241;
      pixels[at + 2] = (x + 3 * y) % 239;
      pixels[at + 3] = 255;
    }
  return { width, height, pixels, order };
}

/** What the PNG of that picture holds: red, green and blue, each row after its filter byte (none). */
function rowsFor({ width, height, pixels, order }: CapturedPicture): Buffer {
  const red = order === 'bgra' ? 2 : 0;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  let to = 0;
  for (let y = 0; y < height; y++) {
    to++;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rows[to++] = pixels[at + red] ?? 0;
      rows[to++] = pixels[at + 1] ?? 0;
      rows[to++] = pixels[at + 2 - red] ?? 0;
    }
  }
  return rows;
}

const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('a phone’s picture made a PNG', () => {
  it('holds every pixel when made in many slices, in either byte order', async () => {
    for (const order of ['bgra', 'rgba'] as const) {
      const picture = pictureOf(300, 400, order);
      expect(rowsOf(await pngOf(picture))).toEqual({ width: 300, height: 400, rows: rowsFor(picture) });
    }
  });

  it('brings a high-density capture down to 1920 on its long side across its slices', async () => {
    // Each two rows of the capture one colour of their own: each row of the PNG is that colour.
    const width = 3840;
    const height = 96;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const band = Math.floor(y / 2);
        pixels.set([band, 100, 200 - band, 255], at);
      }
    const png = rowsOf(await pngOf({ width, height, pixels, order: 'bgra' }));
    expect(png).toMatchObject({ width: 1920, height: 48 });
    const stride = 1920 * 3 + 1;
    for (let y = 0; y < 48; y++) {
      const row = png.rows.subarray(y * stride, (y + 1) * stride);
      // Its filter byte and first pixel, and its last pixel.
      const ends = [...row.subarray(0, 4), ...row.subarray(stride - 3)];
      expect(ends).toEqual([0, 200 - y, 100, y, 200 - y, 100, y]);
    }
  });

  it('waits for its pace before each slice, so none is made while the pace holds', async () => {
    const picture = pictureOf(256, 512);
    // The second look holds (the hall screens moving, say) until let go.
    const paces: (() => void)[] = [];
    const pace = () =>
      new Promise<void>((resolve) => {
        paces.push(resolve);
        if (paces.length !== 2) resolve();
      });
    let made: Buffer | undefined;
    const making = pngOf(picture, pace).then((png) => {
      made = png;
    });
    await until(() => paces.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(paces).toHaveLength(2);
    expect(made).toBeUndefined();
    paces[1]?.();
    await making;
    expect(paces.length).toBeGreaterThan(2);
    if (!made) throw new Error('No PNG was made.');
    expect(rowsOf(made)).toEqual({ width: 256, height: 512, rows: rowsFor(picture) });
  });
});
