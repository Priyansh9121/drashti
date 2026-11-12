import type { RenderSlide } from './model';
import type { PictureLook } from './picture-look';

export type PdfCopyPage =
  { kind: 'original'; sourceId: string; page: number } | { kind: 'native'; slide: RenderSlide };

/** Private to the exact hidden export window. Source bytes never reach an operator or phone. */
export interface PdfCopyJob {
  id: string;
  pages: PdfCopyPage[];
  sources: { id: string; data: Uint8Array }[];
  /** Main requests one PNG of a settled slide for a paired phone. */
  picture?: { scale: number; looks: Record<string, PictureLook> };
}

/** Public PDF.js metadata for the fresh buffer returned by Main's preceding print call. */
export interface PdfPrintPage {
  ref: { num: number; gen: number };
  view: number[];
  rotate: number;
}

export type PdfCopyResult = { ok: true; name: string } | { ok: false; message: string; cancelled?: boolean };

export interface PdfCopyFinished {
  id: string;
  data?: Uint8Array;
  /** Dimensions independently read from the assembled PDF before Main publishes it. */
  pages?: { width: number; height: number }[];
  error?: string;
}
