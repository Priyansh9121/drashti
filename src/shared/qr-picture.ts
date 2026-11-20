import { encode, QrCodeDataType } from 'uqr';

/*
 * The QR code's picture (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download QR code option here.
 * the QR code generated should consist of akshar deri logo, no text just logo, which can be used as well."). One plan
 * of a code, drawn the same way everywhere: the QR code… window's preview, the picture Download… saves (a PNG and an
 * SVG) and the QR-code slide's picture.
 *
 * Without a logo, the code as before: error correction M, its quiet border of four modules. With a logo in the middle
 * (as the owner accepted it): error correction H, and a small white patch of whole modules in the very middle, at most
 * a fifth of the code, the logo one module inside it. The patch never lies on a finder, timing, format or version
 * module, and it is sized for each version so that every block of the code keeps two codewords to spare beyond those
 * the patch touches: the blocks take the codewords in turn, so at some versions (13, 15, 18 and 20 among them) a
 * centred patch of a fifth falls again and again on the same few blocks, and its code cannot be read at all. Where a
 * version leaves the logo less than an eighth of the code, the next version or the one after (a code four or eight
 * modules larger) is used when it has more room. Every picture is read back before it is given (main/library/qr-read).
 */

/** At most this many letters: a longer code is too dense for a phone to read across a hall. */
export const QR_TEXT_MAX = 300;

/** The quiet border round the code, in modules (the standard's four). */
export const QR_BORDER = 4;

/** The white patch for a logo covers at most this share of the code (its modules, without the quiet border). */
export const QR_LOGO_MAX_SHARE = 0.2;

/** Codewords every block keeps spare beyond those the logo's patch touches: room for a phone's own misreads. */
export const QR_LOGO_SPARE = 2;

/** A version whose patch would cover less than this share of its code gives way to a larger one with more room. */
const QR_LOGO_ROOMY = 0.12;

/** At most this many versions above the smallest that holds the words, looking for room for the logo. */
const QR_LOGO_MORE_VERSIONS = 2;

/** The smallest version a logo goes in: the patch of a smaller code would lie on its finder and format modules. */
const QR_LOGO_FIRST_VERSION = 3;

/** About this many pixels square: the picture Download… saves, and the slide's. */
export const QR_DOWNLOAD_PIXELS = 2048;
export const QR_SLIDE_PIXELS = 1080;

/** A square of modules, from the code's top-left corner (without the quiet border). */
export interface QrBox {
  at: number;
  side: number;
}

/** A code as it is drawn. */
export interface QrPlan {
  words: string;
  version: number;
  ecc: 'M' | 'H';
  /** Modules across the code, without its quiet border. */
  size: number;
  border: number;
  /** Its dark modules, row by row (without the border): none under the logo's patch. */
  dark: boolean[][];
  /** The logo's white patch, and the logo's box one module inside it; null without a logo. */
  patch: QrBox | null;
  logo: QrBox | null;
}

/** The words a code is made of: trimmed, or null when there are none or too many. */
export function qrWords(text: string): string | null {
  const words = text.trim();
  return words === '' || words.length > QR_TEXT_MAX ? null : words;
}

type Encoded = ReturnType<typeof encode>;

function tryEncode(words: string, options: Parameters<typeof encode>[1]): Encoded | null {
  try {
    return encode(words, options);
  } catch {
    return null;
  }
}

/*
 * Error correction H's blocks (the standard's table 9, as uqr has it): the codewords each block keeps for correction,
 * and how many blocks, by version (index 0 unused). A block mends half as many wrong codewords as it keeps.
 */
const ECC_PER_BLOCK_H = [
  0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30,
  30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];
const BLOCKS_H = [
  0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45,
  48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
];

/** The modules a version gives its codewords (data and correction, without its function patterns). */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    n -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

interface Layout {
  size: number;
  types: QrCodeDataType[][];
  /** Each codeword's block, codeword by codeword as they are placed. */
  blockOf: number[];
  /** Each data module's codeword, row by row (-1 for a function module or a remainder bit). */
  codewordAt: Int32Array;
  mends: number;
}

const layouts = new Map<number, Layout>();

/** Where a version's codewords lie, and which block each belongs to (at error correction H). */
function layoutOf(version: number): Layout | null {
  const known = layouts.get(version);
  if (known) return known;
  const qr = tryEncode('0', { ecc: 'H', border: 0, minVersion: version, maxVersion: version });
  const ecc = ECC_PER_BLOCK_H[version];
  const blocks = BLOCKS_H[version];
  if (!qr || ecc === undefined || blocks === undefined) return null;
  const size = qr.size;
  const total = Math.floor(rawModules(version) / 8);
  // Short blocks first, each one data codeword fewer than the long ones; the codewords go to the blocks in turn.
  const short = Math.floor(total / blocks);
  const shortBlocks = blocks - (total % blocks);
  const shortData = short - ecc;
  const blockOf: number[] = [];
  for (let i = 0; i <= shortData; i++)
    for (let b = 0; b < blocks; b++) if (i < shortData || b >= shortBlocks) blockOf.push(b);
  for (let i = 0; i < ecc; i++) for (let b = 0; b < blocks; b++) blockOf.push(b);
  // The codewords' bits go up and down the columns two at a time, from the right, skipping the timing column.
  const codewordAt = new Int32Array(size * size).fill(-1);
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? size - 1 - step : step;
        if (qr.types[y]?.[x] !== QrCodeDataType.Data) continue;
        const codeword = Math.floor(bit / 8);
        if (codeword < total) codewordAt[y * size + x] = codeword;
        bit++;
      }
  }
  const layout = { size, types: qr.types, blockOf, codewordAt, mends: ecc / 2 };
  layouts.set(version, layout);
  return layout;
}

/**
 * What a centred patch of `side` modules costs a version's code at error correction H: the most codewords it touches
 * in one block, and how many a block mends. Null where it may not go: on a finder, timing, format or version module.
 */
export function qrPatchCost(version: number, side: number): { worst: number; mends: number } | null {
  const layout = layoutOf(version);
  if (!layout || side < 1 || side % 2 === 0 || side > layout.size) return null;
  const at = (layout.size - side) / 2;
  const touched = new Set<number>();
  for (let y = at; y < at + side; y++)
    for (let x = at; x < at + side; x++) {
      const type = layout.types[y]?.[x];
      if (type !== QrCodeDataType.Data && type !== QrCodeDataType.Alignment) return null;
      const codeword = layout.codewordAt[y * layout.size + x] ?? -1;
      if (codeword >= 0) touched.add(codeword);
    }
  const perBlock = new Map<number, number>();
  let worst = 0;
  for (const codeword of touched) {
    const block = layout.blockOf[codeword] ?? 0;
    const count = (perBlock.get(block) ?? 0) + 1;
    perBlock.set(block, count);
    worst = Math.max(worst, count);
  }
  return { worst, mends: layout.mends };
}

const rooms = new Map<number, { side: number; worst: number; mends: number }>();

/**
 * The largest patch a logo may have at this version (an odd number of modules, at most a fifth of the code, every
 * block keeping QR_LOGO_SPARE codewords to spare), and what it costs the worst block; side 0 where none may go.
 */
export function qrLogoRoom(version: number): { side: number; worst: number; mends: number } {
  const known = rooms.get(version);
  if (known) return known;
  const size = version * 4 + 17;
  let room = { side: 0, worst: 0, mends: 0 };
  for (let side = 1; side * side <= QR_LOGO_MAX_SHARE * size * size; side += 2) {
    const cost = qrPatchCost(version, side);
    if (cost && cost.worst <= cost.mends - QR_LOGO_SPARE) room = { side, ...cost };
  }
  rooms.set(version, room);
  return room;
}

/** The plan of a code of these words, with room for a logo in its middle or not; null when no code can hold them. */
export function qrPlan(text: string, withLogo: boolean): QrPlan | null {
  const words = qrWords(text);
  if (words === null) return null;
  const plan = (qr: Encoded, ecc: QrPlan['ecc'], patch: QrBox | null): QrPlan => ({
    words,
    version: qr.version,
    ecc,
    size: qr.size,
    border: QR_BORDER,
    dark: qr.data.map((row, y) =>
      row.map(
        (dark, x) =>
          dark &&
          !(
            patch &&
            x >= patch.at &&
            x < patch.at + patch.side &&
            y >= patch.at &&
            y < patch.at + patch.side
          ),
      ),
    ),
    patch,
    logo: patch ? { at: patch.at + 1, side: patch.side - 2 } : null,
  });
  if (!withLogo) {
    const qr = tryEncode(words, { ecc: 'M', border: 0 });
    return qr ? plan(qr, 'M', null) : null;
  }
  const first = tryEncode(words, { ecc: 'H', border: 0, minVersion: QR_LOGO_FIRST_VERSION });
  if (!first) return null;
  // The smallest version with room enough for the logo, or else the one with the most room of the next two.
  let best: { qr: Encoded; side: number; share: number } | null = null;
  for (
    let version = first.version;
    version <= Math.min(40, first.version + QR_LOGO_MORE_VERSIONS);
    version++
  ) {
    const qr =
      version === first.version
        ? first
        : tryEncode(words, { ecc: 'H', border: 0, minVersion: version, maxVersion: version });
    const side = qr ? qrLogoRoom(version).side : 0;
    if (!qr || side === 0) continue;
    const share = (side * side) / (qr.size * qr.size);
    if (!best || share > best.share) best = { qr, side, share };
    if (share >= QR_LOGO_ROOMY) break;
  }
  if (!best) return null;
  return plan(best.qr, 'H', { at: (best.qr.size - best.side) / 2, side: best.side });
}

/** Pixels per module, and the picture's side, for a picture of about `about` pixels: whole pixels, at least 4. */
export function qrScale(plan: QrPlan, about: number): { scale: number; side: number } {
  const across = plan.size + 2 * plan.border;
  const scale = Math.max(4, Math.floor(about / across));
  return { scale, side: scale * across };
}

/** The dark modules as one SVG path, in modules, the border included. */
export function qrPath(plan: QrPlan): string {
  let path = '';
  plan.dark.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start + plan.border} ${y + plan.border}h${x - start}v1h${start - x}z`;
    }
  });
  return path;
}

/** A logo's picture as the SVG may carry it: a PNG, as a data URL (nothing else goes into the picture's markup). */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

/**
 * The code as an SVG picture of `pixels` square: white, its dark modules, and the logo (a PNG data URL) fitted in its
 * box. No words of any kind: no text, no title.
 */
export function qrSvg(plan: QrPlan, logoHref: string | null, pixels: number): string {
  const n = plan.size + 2 * plan.border;
  const box = plan.logo;
  const logo =
    box && logoHref !== null && PNG_DATA_URL.test(logoHref)
      ? `<image x="${box.at + plan.border}" y="${box.at + plan.border}" width="${box.side}" height="${box.side}" ` +
        `preserveAspectRatio="xMidYMid meet" xlink:href="${logoHref}"/>`
      : '';
  // xlink:href, which every program that opens an SVG reads (Office's and older drawing programs among them).
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixels}" ` +
    `height="${pixels}" viewBox="0 0 ${n} ${n}">` +
    `<rect width="${n}" height="${n}" fill="#ffffff"/>` +
    `<path d="${qrPath(plan)}" fill="#000000" shape-rendering="crispEdges"/>${logo}</svg>`
  );
}

/** The QR code… window's choices, as Drashti remembers them (Q60-28). */
export interface QrChoices {
  /** The logo kept for the middle of the code: its picture's name, and the picture (a PNG) as a data URL. */
  logo: { name: string; dataUrl: string } | null;
  /** Logo in the middle: on or off (on only with a logo kept). */
  useLogo: boolean;
  /** The words under the code on the slide. */
  wordsUnder: boolean;
}

/** A change to the QR code… window's choices. */
export interface QrChoicesChange {
  useLogo?: boolean;
  wordsUnder?: boolean;
}

export type QrChoicesResult = { ok: true; choices: QrChoices } | { ok: false; message: string };

/** A picture chosen for the logo, as its file is (the window makes the copy Drashti keeps), or why not. */
export type QrPicked =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: false; cancelled: true }
  | { ok: false; message: string };

/** Download…: the files saved (the PNG, then the SVG), or why not. */
export type QrDownloadResult =
  { ok: true; files: string[] } | { ok: false; cancelled: true } | { ok: false; message: string };

/** The QR-code slide's choices: the logo code, and its words under the code (both as the window has them). */
export interface QrSlideOptions {
  logo?: boolean;
  words?: boolean;
}
