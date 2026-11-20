import { crc32, deflateSync } from 'node:zlib';
import { encode, QrCodeDataType } from 'uqr';
import { describe, expect, it } from 'vitest';
import type { QrPlan } from '../../shared/qr-picture';
import {
  QR_BORDER,
  QR_DOWNLOAD_PIXELS,
  QR_LOGO_MAX_SHARE,
  QR_LOGO_SPARE,
  QR_SLIDE_PIXELS,
  QR_TEXT_MAX,
  qrLogoRoom,
  qrPatchCost,
  qrPlan,
  qrScale,
} from '../../shared/qr-picture';
import { makeQr } from './qr-maker';
import type { Pixels } from './qr-raster';
import { qrRaster, readPng, writePng } from './qr-raster';
import { readQr } from './qr-read';
import { PLACEHOLDER_LOGO_MIDDLE, placeholderLogoPixels, placeholderLogoPng } from './testing/qr-logo';

/*
 * The QR code's picture (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download QR code option
 * here. the QR code generated should consist of akshar deri logo, no text just logo, which can be used as well.").
 * With a logo in the middle the code is made at error correction H, the logo on a small white patch of whole modules
 * in the very middle, at most a fifth of the code, its quiet border kept; and every code is read back by a QR reader
 * (qr 0.7.2, the owner's "Yes, A" to Q60-33) before Download… saves it or Make the slide uses it. A generated
 * placeholder logo only (testing/qr-logo.ts), never the mandir's; placeholder links and words only.
 */

const LINK = 'https://example.org/placeholder-sabha';
const GUJARATI = 'પ્લેસહોલ્ડર સભા';
/** Words of many lengths, so the codes come in many sizes (versions 3 to 18 at error correction H). */
const LENGTHS = [
  1,
  2,
  7,
  14,
  20,
  26,
  34,
  44,
  58,
  64,
  84,
  98,
  119,
  137,
  155,
  177,
  194,
  220,
  250,
  271,
  QR_TEXT_MAX,
];
const wordsOf = (n: number): string => `https://example.org/${'placeholder-'.repeat(30)}`.slice(0, n);

const logoPng = placeholderLogoPng();

/** A plan's module at (x, y), the border included: dark or not. */
const darkAt = (plan: QrPlan, x: number, y: number): boolean =>
  plan.dark[y - plan.border]?.[x - plan.border] === true;

/** A picture's pixel at (x, y) as [r, g, b] (alpha over white). */
function rgbAt(img: Pixels, x: number, y: number): [number, number, number] {
  const at = (y * img.width + x) * img.channels;
  if (img.channels === 1) {
    const v = img.data[at] ?? -1;
    return [v, v, v];
  }
  const a = img.channels === 4 ? (img.data[at + 3] ?? 255) / 255 : 1;
  const c = (k: number) => Math.round((img.data[at + k] ?? 0) * a + 255 * (1 - a));
  return [c(0), c(1), c(2)];
}

describe('the QR code’s picture, with a logo in the middle (Q60-28)', () => {
  it('without a logo: error correction M, the quiet border of 4 and nothing cleared, as before', () => {
    const plan = qrPlan(LINK, false);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.ecc).toBe('M');
    expect(plan.border).toBe(QR_BORDER);
    expect(plan.patch).toBeNull();
    expect(plan.logo).toBeNull();
    expect(plan.dark).toEqual(encode(LINK, { ecc: 'M', border: 0 }).data);
  });

  it('with a logo: error correction H, a white patch of whole modules in the very middle, at most a fifth of the code, the logo one module inside it, and no finder, timing, format or version module under it', () => {
    for (const words of [...LENGTHS.map(wordsOf), GUJARATI]) {
      const plan = qrPlan(words, true);
      expect(plan, words).not.toBeNull();
      if (!plan) continue;
      expect(plan.ecc, words).toBe('H');
      expect(plan.border).toBe(QR_BORDER);
      const patch = plan.patch;
      const logo = plan.logo;
      expect(patch, words).not.toBeNull();
      if (!patch || !logo) continue;
      // Whole modules, an odd number across, centred.
      expect(patch.side % 2, words).toBe(1);
      expect(patch.at * 2 + patch.side, words).toBe(plan.size);
      expect(patch.side * patch.side, words).toBeLessThanOrEqual(QR_LOGO_MAX_SHARE * plan.size * plan.size);
      // Large enough to see: at least 9 modules across.
      expect(patch.side, words).toBeGreaterThanOrEqual(9);
      expect(logo).toEqual({ at: patch.at + 1, side: patch.side - 2 });
      // The code itself at that version, error correction H: the same modules everywhere but under the patch.
      const code = encode(words, { ecc: 'H', border: 0, minVersion: plan.version, maxVersion: plan.version });
      expect(code.size).toBe(plan.size);
      for (let y = 0; y < plan.size; y++)
        for (let x = 0; x < plan.size; x++) {
          const under =
            x >= patch.at && x < patch.at + patch.side && y >= patch.at && y < patch.at + patch.side;
          if (under) {
            expect(plan.dark[y]?.[x], `${words} ${String(x)},${String(y)}`).toBe(false);
            // Only data and the alignment patterns lie under it (readers find the code by its corners).
            expect([QrCodeDataType.Data, QrCodeDataType.Alignment]).toContain(code.types[y]?.[x]);
          } else expect(plan.dark[y]?.[x], `${words} ${String(x)},${String(y)}`).toBe(code.data[y]?.[x]);
        }
    }
  });

  it('the patch leaves every block of the code two codewords to spare (for a phone’s own misreads), at every version', () => {
    for (let version = 3; version <= 40; version++) {
      const room = qrLogoRoom(version);
      const size = version * 4 + 17;
      expect(room.side, `version ${String(version)}`).toBeGreaterThanOrEqual(9);
      expect(room.side * room.side).toBeLessThanOrEqual(QR_LOGO_MAX_SHARE * size * size);
      expect(room.worst, `version ${String(version)}`).toBeLessThanOrEqual(room.mends - QR_LOGO_SPARE);
      expect(qrPatchCost(version, room.side)).toEqual({ worst: room.worst, mends: room.mends });
    }
    // A patch over a finder, timing or format module may not go at all.
    expect(qrPatchCost(3, 15)).toBeNull();
    // Version 13 with the largest centred patch under a fifth (29 modules): one block loses 16 codewords, more than
    // the 11 it can mend (the blocks take the codewords in turn, and the patch's columns fall on the same few).
    expect(qrPatchCost(13, 29)).toEqual({ worst: 16, mends: 11 });
  });

  it('a patch that takes more than a block can mend cannot be read, and the one Drashti chooses can: the reader is a real check', () => {
    // Words whose smallest code at error correction H is version 13.
    const words = wordsOf(170);
    expect(encode(words, { ecc: 'H', border: 0 }).version).toBe(13);
    const plan = qrPlan(words, true);
    if (!plan?.patch) throw new Error('no plan');
    const code = encode(words, { ecc: 'H', border: 0, minVersion: 13, maxVersion: 13 });
    const at = (code.size - 29) / 2;
    const cleared: QrPlan = {
      ...plan,
      version: 13,
      size: code.size,
      dark: code.data.map((row, y) =>
        row.map((dark, x) => dark && !(x >= at && x < at + 29 && y >= at && y < at + 29)),
      ),
      patch: { at, side: 29 },
      logo: { at: at + 1, side: 27 },
    };
    expect(readQr(qrRaster(cleared, QR_SLIDE_PIXELS, null))).not.toBe(words);
    expect(readQr(qrRaster(plan, QR_SLIDE_PIXELS, placeholderLogoPixelsOf()))).toBe(words);
  });

  it('every code is read back: with the placeholder logo and without, words of every length up to 300 letters and Gujarati, the PNG Download… saves (about 2048 pixels) and the slide’s (about 1080) both read as their words', () => {
    const read = (png: Uint8Array): string | null => {
      const img = readPng(png);
      return img ? readQr(img) : null;
    };
    for (const words of [...LENGTHS.map(wordsOf), GUJARATI])
      for (const logo of [logoPng, null]) {
        const slide = makeQr({ words, logo, about: QR_SLIDE_PIXELS, svg: false }, readQr);
        expect(slide.ok, words).toBe(true);
        if (slide.ok) expect(read(slide.png), words).toBe(words);
      }
    for (const words of [LINK, GUJARATI, wordsOf(QR_TEXT_MAX)]) {
      const made = makeQr({ words, logo: logoPng, about: QR_DOWNLOAD_PIXELS, svg: true }, readQr);
      expect(made.ok, words).toBe(true);
      if (made.ok) expect(read(made.png), words).toBe(words);
    }
  }, 60_000);

  it('a code its reader cannot read is never given: it says so, and gives no picture', () => {
    const made = makeQr({ words: LINK, logo: logoPng, about: QR_DOWNLOAD_PIXELS, svg: true }, () => null);
    expect(made).toEqual({
      ok: false,
      message: expect.stringContaining('could not be read back') as unknown,
    });
    const wrong = makeQr(
      { words: LINK, logo: null, about: QR_SLIDE_PIXELS, svg: false },
      () => 'other words',
    );
    expect(wrong.ok).toBe(false);
  });

  it('Download…’s PNG is the code and the logo only: square, about 2048 pixels, the quiet border white, every module as the code has it, white round the logo, and the logo’s middle in its own colours', () => {
    const made = makeQr({ words: LINK, logo: logoPng, about: QR_DOWNLOAD_PIXELS, svg: true }, readQr);
    if (!made.ok) throw new Error(made.message);
    const img = readPng(made.png);
    const plan = qrPlan(LINK, true);
    if (!img || !plan?.patch || !plan.logo) throw new Error('no picture or no plan');
    expect(img.width).toBe(img.height);
    expect(img.width).toBe(made.side);
    expect(img.width).toBeGreaterThan(QR_DOWNLOAD_PIXELS * 0.9);
    expect(img.width).toBeLessThanOrEqual(QR_DOWNLOAD_PIXELS);
    const { scale } = qrScale(plan, QR_DOWNLOAD_PIXELS);
    const n = plan.size + 2 * plan.border;
    const patch = plan.patch;
    const inPatch = (m: number) => m >= patch.at + plan.border && m < patch.at + plan.border + patch.side;
    for (let my = 0; my < n; my++)
      for (let mx = 0; mx < n; mx++) {
        if (inPatch(mx) && inPatch(my)) continue;
        const [r, g, b] = rgbAt(img, mx * scale + (scale >> 1), my * scale + (scale >> 1));
        const want = darkAt(plan, mx, my) ? 0 : 255;
        expect([r, g, b], `${String(mx)},${String(my)}`).toEqual([want, want, want]);
      }
    // The patch's ring of one module round the logo's box: white.
    const p0 = (patch.at + plan.border) * scale;
    const p1 = p0 + patch.side * scale;
    for (let i = p0; i < p1; i += scale >> 1) {
      for (const [x, y] of [
        [i, p0 + 1],
        [i, p1 - 2],
        [p0 + 1, i],
        [p1 - 2, i],
      ] as const)
        expect(rgbAt(img, x, y), `${String(x)},${String(y)}`).toEqual([255, 255, 255]);
    }
    // The logo's middle, in its own colours.
    const middle = rgbAt(img, img.width >> 1, img.height >> 1);
    middle.forEach((c, i) => {
      expect(Math.abs(c - (PLACEHOLDER_LOGO_MIDDLE[i] ?? 0))).toBeLessThanOrEqual(3);
    });
  });

  it('the SVG Download… saves is the same code: its modules, white under the patch, the logo in its box as its own picture, and no words', () => {
    const made = makeQr({ words: LINK, logo: logoPng, about: QR_DOWNLOAD_PIXELS, svg: true }, readQr);
    if (!made.ok || made.svg === null) throw new Error('no SVG');
    const plan = qrPlan(LINK, true);
    if (!plan?.logo) throw new Error('no plan');
    const svg = made.svg;
    const n = plan.size + 2 * plan.border;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${String(n)} ${String(n)}"`);
    expect(svg).toContain(`width="${String(made.side)}" height="${String(made.side)}"`);
    // No words of any kind.
    expect(svg).not.toMatch(/<text|<title|<desc|<foreignObject/u);
    // Its dark modules, from its path: exactly the plan's.
    const d = /<path d="([^"]*)"/u.exec(svg)?.[1] ?? '';
    const dark = new Set<string>();
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)) {
      const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let i = 0; i < w; i++) dark.add(`${String(x + i)},${String(y)}`);
    }
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        expect(dark.has(`${String(x)},${String(y)}`), `${String(x)},${String(y)}`).toBe(darkAt(plan, x, y));
    // The logo: the kept PNG itself, in the logo's box.
    const box = plan.logo;
    const image = /<image ([^>]*)\/>/u.exec(svg)?.[1] ?? '';
    expect(image).toContain(`x="${String(box.at + plan.border)}" y="${String(box.at + plan.border)}"`);
    expect(image).toContain(`width="${String(box.side)}" height="${String(box.side)}"`);
    expect(image).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(image).toContain(`href="data:image/png;base64,${Buffer.from(logoPng).toString('base64')}"`);
  });

  it('reads the PNGs a logo’s kept copy may be: grey, grey and alpha, RGB and RGBA, every row filter', () => {
    const width = 5;
    const height = 4;
    const rgba = placeholderLogoPixels(width, height);
    for (const channels of [1, 2, 3, 4] as const) {
      // The same pixels in each colour type, each row with another filter (none, sub, up, average, Paeth).
      const pixels = new Uint8Array(width * height * channels);
      for (let i = 0; i < width * height; i++)
        for (let c = 0; c < channels; c++) {
          const from = channels <= 2 ? (c === 0 ? 0 : 3) : c;
          pixels[i * channels + c] = rgba[i * 4 + from] ?? 0;
        }
      const png = filteredPng(width, height, channels, pixels);
      const img = readPng(png);
      expect(img, `${String(channels)} channels`).not.toBeNull();
      if (!img) continue;
      expect([img.width, img.height, img.channels]).toEqual([width, height, 4]);
      for (let i = 0; i < width * height; i++) {
        const want =
          channels === 1
            ? [pixels[i], pixels[i], pixels[i], 255]
            : channels === 2
              ? [pixels[i * 2], pixels[i * 2], pixels[i * 2], pixels[i * 2 + 1]]
              : channels === 3
                ? [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], 255]
                : [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], pixels[i * 4 + 3]];
        expect(
          [...img.data.subarray(i * 4, i * 4 + 4)],
          `${String(channels)} channels, pixel ${String(i)}`,
        ).toEqual(want);
      }
    }
    // Not a PNG, or one it does not read: none.
    expect(readPng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      readPng(writePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(12) }).subarray(0, 40)),
    ).toBeNull();
  });
});

/** The placeholder logo's pixels, as readPng gives them. */
function placeholderLogoPixelsOf(): Pixels {
  return { width: 256, height: 256, channels: 4, data: placeholderLogoPixels() };
}

/** A PNG of these pixels (8 bits a channel), its rows filtered in turn none, sub, up, average and Paeth. */
function filteredPng(width: number, height: number, channels: 1 | 2 | 3 | 4, pixels: Uint8Array): Uint8Array {
  const row = width * channels;
  const raw: number[] = [];
  const at = (y: number, x: number) => (y < 0 || x < 0 ? 0 : (pixels[y * row + x] ?? 0));
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw.push(filter);
    for (let x = 0; x < row; x++) {
      const left = at(y, x - channels);
      const up = at(y - 1, x);
      const ul = at(y - 1, x - channels);
      const p = left + up - ul;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - ul)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter] ?? 0;
      raw.push((at(y, x) - predicted) & 0xff);
    }
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const out = Buffer.alloc(8 + typed.length);
    out.writeUInt32BE(body.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc32(typed), 4 + typed.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
