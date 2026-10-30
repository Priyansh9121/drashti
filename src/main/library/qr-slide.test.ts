import { inflateSync } from 'node:zlib';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import type { NewSlideLook } from './words';
import { QR_TEXT_MAX, qrPng, qrSlideName, qrSlidePresentation } from './qr-slide';

/*
 * The QR-code slide (Session 55, Part 8, the owner's idea G): a link or words pasted become a slide with a large code
 * and the words under it, made here offline with the QR encoder Drashti already has (uqr, MIT). The code is a PNG
 * picture in the library; the slide holds it large in the middle and the words under it. Placeholder links only.
 */

const LINK = 'https://example.org/placeholder-sabha';

/** A PNG's size and its grey pixels (8-bit greyscale, no interlace, filter 0 on every row: what qrPng writes). */
function readPng(png: Uint8Array): { width: number; height: number; at: (x: number, y: number) => number } {
  const bytes = Buffer.from(png);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      // 8 bits, greyscale, no interlace.
      expect([body[8], body[9], body[12]]).toEqual([8, 0, 0]);
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  expect(raw.length).toBe(height * (width + 1));
  return { width, height, at: (x, y) => raw[y * (width + 1) + 1 + x] ?? -1 };
}

const look: NewSlideLook = {
  frame: { x: 96, y: 96, width: 1728, height: 888 },
  style: {
    fontFamily: null,
    fontSize: 90,
    fontWeight: 700,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
  langs: {},
  background: '#101820',
};

describe('the QR-code slide', () => {
  it('draws the code as a PNG: black modules on white, with its quiet border, large enough to read across a hall', () => {
    const png = qrPng(LINK);
    expect(png).not.toBeNull();
    const img = readPng(png ?? new Uint8Array());
    const qr = encode(LINK, { ecc: 'M', border: 4 });
    expect(img.width).toBe(img.height);
    expect(img.width).toBeGreaterThanOrEqual(1000);
    expect(img.width % qr.size).toBe(0);
    const scale = img.width / qr.size;
    // Every module's middle pixel: black where the code has one, white elsewhere (the border too).
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) {
        const want = qr.data[y]?.[x] === true ? 0 : 255;
        expect(
          img.at(x * scale + Math.floor(scale / 2), y * scale + Math.floor(scale / 2)),
          `${String(x)},${String(y)}`,
        ).toBe(want);
      }
    // Words in Gujarati make a code too (UTF-8).
    expect(qrPng('પ્લેસહોલ્ડર સભા')).not.toBeNull();
  });

  it('turns down empty words, and words too long for a code a phone reads across a hall', () => {
    expect(qrPng('')).toBeNull();
    expect(qrPng('   ')).toBeNull();
    expect(qrPng('x'.repeat(QR_TEXT_MAX))).not.toBeNull();
    expect(qrPng('x'.repeat(QR_TEXT_MAX + 1))).toBeNull();
  });

  it('makes one slide: the code large in the middle, the words under it in the look of a new slide', () => {
    const made = qrSlidePresentation('library-1', 'QR code: placeholder', LINK, 'media-qr', look);
    expect(made.name).toBe('QR code: placeholder');
    expect(made.groups).toHaveLength(1);
    const slides = made.groups[0]?.slides ?? [];
    expect(slides).toHaveLength(1);
    const elements = slides[0]?.elements ?? [];
    const picture = elements.find((e) => e.kind === 'image');
    const words = elements.find((e) => e.kind === 'text');
    if (picture?.kind !== 'image' || words?.kind !== 'text') throw new Error('no picture or no words');
    expect(picture.mediaId).toBe('media-qr');
    // Square, at least half the slide's height, in the middle across.
    expect(picture.frame.width).toBe(picture.frame.height);
    expect(picture.frame.height).toBeGreaterThanOrEqual(made.height / 2);
    expect(picture.frame.x + picture.frame.width / 2).toBe(made.width / 2);
    // The words under it, across the slide, in the middle.
    expect(words.text).toBe(LINK);
    expect(words.frame.y).toBeGreaterThanOrEqual(picture.frame.y + picture.frame.height);
    expect(words.frame.y + words.frame.height).toBeLessThanOrEqual(made.height);
    expect(words.style.align).toBe('center');
    expect(words.style.shrinkToFit).toBe(true);
    expect(slides[0]?.background).toBe('#101820');
  });

  it('is named after its words, cut on a letter', () => {
    expect(qrSlideName(LINK)).toBe(`QR code: ${LINK}`);
    const long = qrSlideName('પ્લેસહોલ્ડર '.repeat(20));
    expect(long.startsWith('QR code: પ્લેસહોલ્ડર')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
