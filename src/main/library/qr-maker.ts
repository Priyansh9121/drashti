import { qrPlan, qrScale, qrSvg } from '../../shared/qr-picture';
import type { Pixels } from './qr-raster';
import { qrRaster, writePng } from './qr-raster';

/*
 * One QR code's pictures (Q60-28), made in the QR worker (qr-worker.ts), off Main's thread: the PNG (about 2048 pixels
 * for Download…, about 1080 for the slide) and, for Download…, the SVG, with the logo in the middle when one is given,
 * each read back first. Red stand-in: no logo and no reading back yet.
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

/** Make a code's pictures; `read` reads a picture back (qr-read.ts). */
export function makeQr(job: QrJob, _read: (img: Pixels) => string | null): QrMade {
  const plan = qrPlan(job.words, false);
  if (!plan) return { ok: false, message: QR_TOO_LONG };
  const raster = qrRaster(plan, job.about, null);
  const { side } = qrScale(plan, job.about);
  return { ok: true, png: writePng(raster), svg: job.svg ? qrSvg(plan, null, side) : null, side };
}
