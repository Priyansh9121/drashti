import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cannotSeeThrough, pictureCannotSeeThrough, type ReadBytes } from './see-through';

/*
 * Whether a picture can draw no see-through pixel (X11), from its file's first bytes only: a JPEG, or a still PNG
 * whose colour type has no alpha and with no transparency chunk before its picture data. Generated headers only.
 */

const reader =
  (bytes: Uint8Array): ReadBytes =>
  (at, length) =>
    at >= bytes.length ? null : bytes.subarray(at, Math.min(bytes.length, at + length));

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A word's letters as bytes (ASCII only). */
const ascii = (word: string): number[] => Array.from({ length: word.length }, (_, i) => word.charCodeAt(i));
/** A PNG chunk: its length, type, data and a CRC left at 0 (never read). */
const chunk = (type: string, data: number[]): number[] => [
  (data.length >>> 24) & 0xff,
  (data.length >>> 16) & 0xff,
  (data.length >>> 8) & 0xff,
  data.length & 0xff,
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
/** IHDR of a 1920 x 1080 picture, 8 bits, of colour type `colour`. */
const ihdr = (colour: number) => chunk('IHDR', [0, 0, 7, 128, 0, 0, 4, 56, 8, colour, 0, 0, 0]);
const png = (...chunks: number[][]) => Uint8Array.from([...SIGNATURE, ...chunks.flat()]);
const IDAT = chunk('IDAT', [1, 2, 3, 4]);
const IEND = chunk('IEND', []);

describe('a picture that can draw no see-through pixel (X11)', () => {
  it('a JPEG, by its first bytes', () => {
    expect(cannotSeeThrough(reader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])))).toBe(
      true,
    );
  });

  it('a still PNG of grey, colour or a palette with no transparency chunk before its picture data', () => {
    for (const colour of [0, 2, 3])
      expect(cannotSeeThrough(reader(png(ihdr(colour), IDAT, IEND))), `colour type ${String(colour)}`).toBe(
        true,
      );
    // Other chunks before the picture data (a palette, text, a colour profile) are passed over by their length.
    const text = chunk('tEXt', [...ascii('Comment'), 0, 65, 66]);
    const palette = chunk('PLTE', [0, 0, 0, 255, 255, 255]);
    expect(cannotSeeThrough(reader(png(ihdr(3), palette, text, IDAT, IEND)))).toBe(true);
  });

  it('never a PNG with an alpha channel, a transparency chunk or frames of its own', () => {
    for (const colour of [4, 6])
      expect(cannotSeeThrough(reader(png(ihdr(colour), IDAT, IEND))), `colour type ${String(colour)}`).toBe(
        false,
      );
    for (const colour of [0, 2, 3])
      expect(
        cannotSeeThrough(reader(png(ihdr(colour), chunk('tRNS', [0, 0]), IDAT, IEND))),
        `colour type ${String(colour)} with a transparent colour`,
      ).toBe(false);
    // An animated PNG may clear a frame to transparent black whatever its colour type.
    const actl = chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]);
    expect(cannotSeeThrough(reader(png(ihdr(2), actl, IDAT, IEND)))).toBe(false);
  });

  it('never any other file, a PNG cut short or not as PNG writes it, or nothing at all', () => {
    const gif = Uint8Array.from(ascii('GIF89a'));
    const webp = Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]);
    for (const [what, bytes] of [
      ['GIF', gif],
      ['WebP', webp],
      ['empty', new Uint8Array(0)],
      ['a PNG cut short before its picture data', png(ihdr(2))],
      ['a PNG cut short in its header', png(ihdr(2)).subarray(0, 20)],
      ['a PNG whose first chunk is not its header', png(chunk('tEXt', [65]), ihdr(2), IDAT)],
    ] as const)
      expect(cannotSeeThrough(reader(bytes)), what).toBe(false);
    // Read only so far: a PNG with more chunks before its picture data than any picture has is not known.
    const many = Array.from({ length: 80 }, () => chunk('tEXt', [65]));
    expect(cannotSeeThrough(reader(png(ihdr(2), ...many, IDAT, IEND)))).toBe(false);
  });
});

describe('a picture file on disk that can draw no see-through pixel (X11)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-see-through-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('read from its first bytes; a file that is not there is not known', async () => {
    writeFileSync(join(dir, 'a.jpg'), Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 67, 0]));
    writeFileSync(join(dir, 'b.png'), png(ihdr(2), IDAT, IEND));
    writeFileSync(join(dir, 'c.png'), png(ihdr(6), IDAT, IEND));
    expect(await pictureCannotSeeThrough(join(dir, 'a.jpg'))).toBe(true);
    expect(await pictureCannotSeeThrough(join(dir, 'b.png'))).toBe(true);
    expect(await pictureCannotSeeThrough(join(dir, 'c.png'))).toBe(false);
    expect(await pictureCannotSeeThrough(join(dir, 'gone.jpg'))).toBe(false);
  });
});
