import { qrPlan, qrScale, qrSvg } from '../../shared/qr-picture';
import type { Pixels } from './qr-raster';
import { QR_LOGO_MAX_SIDE, qrRaster, readPng, writePng } from './qr-raster';

/*
 * One QR code's pictures (Q60-28), made in the QR worker (qr-worker.ts), off Main's thread: the PNG (about 2048 pixels
 * for Download…, about 1080 for the slide) and, for Download…, the SVG, with the logo in the middle when one is given.
 * Each code is read back from the PNG's own pixels before anything is given (the owner's acceptance: "every code
 * decoded by a reader before it can be saved or put on a slide"); the SVG is the same plan drawn as shapes.
 */

/** What to make. */
export interface QrJob {
  words: string;
  /** The logo's kept copy (a PNG Drashti made), or null for none. */
  logo: Uint8Array | null;
  /** About this many pixels square. */
  about: number;
  /** The SVG too (Download…). */
  svg: boolean;
}

export type QrMade =
  { ok: true; png: Uint8Array; svg: string | null; side: number } | { ok: false; message: string };

/** The words cannot be made into a code. */
export const QR_TOO_LONG = 'Those words cannot be made into a QR code: use fewer.';

/** The logo's kept copy cannot be read. */
export const QR_LOGO_UNREADABLE =
  'The logo’s picture could not be read: choose it again with Choose a Picture….';

/** The code was made, and a QR reader could not read it back: nothing is given. */
export const QR_NOT_READ =
  'This code could not be read back, so it was not used. Try fewer words, or the code without the logo.';

/** Make a code's pictures; `read` reads a picture back (qr-read.ts). */
export function makeQr(job: QrJob, read: (img: Pixels) => string | null): QrMade {
  let logo: Pixels | null = null;
  if (job.logo) {
    logo = readPng(job.logo);
    if (!logo || logo.width > QR_LOGO_MAX_SIDE || logo.height > QR_LOGO_MAX_SIDE)
      return { ok: false, message: QR_LOGO_UNREADABLE };
  }
  const plan = qrPlan(job.words, logo !== null);
  if (!plan) return { ok: false, message: QR_TOO_LONG };
  const raster = qrRaster(plan, job.about, logo);
  // Read back as a phone's camera would a perfect print of it: anything else, and nothing is given.
  if (read(raster) !== plan.words) return { ok: false, message: QR_NOT_READ };
  const { side } = qrScale(plan, job.about);
  const svg =
    job.svg && job.logo
      ? qrSvg(plan, `data:image/png;base64,${Buffer.from(job.logo).toString('base64')}`, side)
      : job.svg
        ? qrSvg(plan, null, side)
        : null;
  return { ok: true, png: writePng(raster), svg, side };
}
