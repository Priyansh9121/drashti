import { encode } from 'uqr';

/*
 * The QR code's picture (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download QR code option here.
 * the QR code generated should consist of akshar deri logo, no text just logo, which can be used as well."). One plan
 * of a code, drawn the same way everywhere: the QR code… window's preview, the picture Download… saves (a PNG and an
 * SVG) and the QR-code slide's picture. Red stand-in: the code as before (error correction M), no logo yet.
 */

/** At most this many letters: a longer code is too dense for a phone to read across a hall. */
export const QR_TEXT_MAX = 300;

/** The quiet border round the code, in modules (the standard's four). */
export const QR_BORDER = 4;

/** The white patch for a logo covers at most this share of the code (its modules, without the quiet border). */
export const QR_LOGO_MAX_SHARE = 0.2;

/** Codewords every block keeps spare beyond those the logo's patch touches: room for a phone's own misreads. */
export const QR_LOGO_SPARE = 2;

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

/** The plan of a code of these words, with room for a logo in its middle or not; null when no code can hold them. */
export function qrPlan(text: string, _withLogo: boolean): QrPlan | null {
  const words = qrWords(text);
  if (words === null) return null;
  let qr: ReturnType<typeof encode>;
  try {
    qr = encode(words, { ecc: 'M', border: 0 });
  } catch {
    return null;
  }
  return {
    words,
    version: qr.version,
    ecc: 'M',
    size: qr.size,
    border: QR_BORDER,
    dark: qr.data,
    patch: null,
    logo: null,
  };
}

/** What a centred patch of `side` modules costs a version's code at error correction H: null where it may not go. */
export function qrPatchCost(_version: number, _side: number): { worst: number; mends: number } | null {
  return null;
}

/** The largest patch a logo may have at this version (0 for none), and what it costs the worst block. */
export function qrLogoRoom(_version: number): { side: number; worst: number; mends: number } {
  return { side: 0, worst: 0, mends: 0 };
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
      path += `M${String(start + plan.border)} ${String(y + plan.border)}h${String(x - start)}v1h${String(start - x)}z`;
    }
  });
  return path;
}

/** The code as an SVG picture of `pixels` square: white, its dark modules, and the logo (a PNG data URL) in its box. */
export function qrSvg(plan: QrPlan, _logoHref: string | null, pixels: number): string {
  const n = plan.size + 2 * plan.border;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(pixels)}" height="${String(pixels)}" ` +
    `viewBox="0 0 ${String(n)} ${String(n)}"><rect width="${String(n)}" height="${String(n)}" fill="#ffffff"/>` +
    `<path d="${qrPath(plan)}" fill="#000000" shape-rendering="crispEdges"/></svg>`
  );
}
