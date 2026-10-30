import { deflateSync } from 'node:zlib';
import { encode } from 'uqr';
import type { NewPresentation } from '../db/presentations';
import { cutText } from '../../shared/text';
import type { MediaElement, TextElement } from '../../shared/model';
import { lookText, type NewSlideLook } from './words';

/*
 * The QR-code slide (Session 55, Part 8, the owner's idea G): New › QR code… makes, from a link or words pasted, one
 * slide with a large code in the middle and the words under it. Made here, offline, with the QR encoder Drashti already
 * has for pairing phones (uqr, MIT): the code becomes a PNG picture in the library (black on white with its quiet
 * border, about 1080 pixels square, so a phone reads it from the back of the hall), and the slide holds it.
 */

/** At most this many letters: a longer code is too dense for a phone to read across a hall. */
export const QR_TEXT_MAX = 300;

/** About this many pixels square: each module a whole number of pixels. */
const PNG_SIDE = 1080;

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

/** The words a code is made of: trimmed, or null when there are none or too many. */
export function qrWords(text: string): string | null {
  const words = text.trim();
  return words === '' || words.length > QR_TEXT_MAX ? null : words;
}

/**
 * The code of a link or words as a PNG: 8-bit grey, black modules on white with a quiet border of 4, each module a
 * whole number of pixels (about 1080 square). Null for no words, or words too long.
 */
export function qrPng(text: string): Uint8Array | null {
  const words = qrWords(text);
  if (words === null) return null;
  let qr: ReturnType<typeof encode>;
  try {
    qr = encode(words, { ecc: 'M', border: 4 });
  } catch {
    return null;
  }
  const scale = Math.max(4, Math.floor(PNG_SIDE / qr.size));
  const side = qr.size * scale;
  const stride = side + 1;
  // Every row starts with its filter (0, none), then its pixels: white, black where the code has a module.
  const raw = Buffer.alloc(side * stride, 255);
  for (let y = 0; y < side; y++) {
    raw[y * stride] = 0;
    const row = qr.data[Math.floor(y / scale)] ?? [];
    for (let x = 0; x < side; x++) if (row[Math.floor(x / scale)] === true) raw[y * stride + 1 + x] = 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bits
  header[9] = 0; // grey
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Its name in the library: "QR code: " and its words on one line, cut on a letter. */
export function qrSlideName(text: string): string {
  return `QR code: ${cutText(text.trim().replace(/\s+/gu, ' '), 71, '…')}`;
}

const W = 1920;
const H = 1080;
/** The code's side on the slide, and the space above it and between it and the words. */
const CODE = 720;
const TOP = 72;
const GAP = 24;

/** One slide: the code large in the middle, the words under it in the look a new slide has (centred, shrinking to fit). */
export function qrSlidePresentation(
  libraryId: string,
  name: string,
  text: string,
  mediaId: string,
  look: NewSlideLook,
): NewPresentation & { width: number; height: number } {
  const words = text.trim();
  const code: MediaElement = {
    id: 'qr',
    kind: 'image',
    frame: { x: (W - CODE) / 2, y: TOP, width: CODE, height: CODE },
    mediaId,
    fit: 'fit',
  };
  const below = TOP + CODE + GAP;
  const props = lookText([words], look);
  const caption: TextElement = {
    id: 'text',
    kind: 'text',
    frame: { x: 120, y: below, width: W - 240, height: H - below - 48 },
    ...props,
    style: { ...props.style, fontSize: 56, align: 'center', verticalAlign: 'top', shrinkToFit: true },
  };
  return {
    libraryId,
    name,
    width: W,
    height: H,
    groups: [{ name: '', color: null, slides: [{ elements: [code, caption], background: look.background }] }],
    arrangements: [],
    selectedArrangement: null,
    source: { kind: 'drashti', path: null, ref: null, importedAt: null },
  };
}
