/*
 * PDF, PowerPoint and Keynote as pictures (Session 15). Each page of a
 * document becomes a slide holding one full-frame picture at the canvas
 * size, with the speaker notes as the slide's notes where the file has them.
 * A PDF is drawn by pdf.js in a hidden window of its own; a PowerPoint or
 * Keynote file is first saved as PDF by Keynote (on a Mac) or PowerPoint
 * (where it is installed). Animations and builds come out as each slide's
 * finished picture. It goes through the import worker's queue like any other
 * import, so it never slows the show.
 */

/** The files that become pictures, by extension. */
export const PICTURE_EXTENSIONS = ['pdf', 'pptx', 'ppt', 'key'] as const;
export type PictureSource = (typeof PICTURE_EXTENSIONS)[number];

export function pictureSourceOf(ext: string): PictureSource | null {
  const lower = ext.toLowerCase();
  return (PICTURE_EXTENSIONS as readonly string[]).includes(lower) ? (lower as PictureSource) : null;
}

/** At most this many pages of one document become slides; the report says when there were more. */
export const MAX_PICTURE_PAGES = 400;

/** What the hidden window is asked to draw (it asks for it when it has loaded). */
export interface PictureJob {
  /** The PDF's bytes. */
  data: Uint8Array;
  /** The picture's size: the canvas every page is fitted into, on black. */
  width: number;
  height: number;
  maxPages: number;
}

/** One page as the hidden window drew it: a PNG of the canvas size, and the page's comments. */
export interface PicturePage {
  /** From 0. */
  index: number;
  png: Uint8Array;
  /** The page's comments (sticky notes), as a PDF's speaker notes: '' when it has none. */
  notes: string;
}

/** How the drawing ended. */
export interface PicturesDone {
  /** Pages in the document. */
  total: number;
  /** Pages that could not be drawn (from 0). */
  failed: number[];
  /** Why nothing could be drawn (a password, a damaged file), when that is so. */
  error?: string;
}

/** Where pdf.js's own data comes from (fonts PDFs name without embedding them, and its decoders). */
export type PictureAssetKind = 'standardFontDataUrl' | 'wasmUrl' | 'cMapUrl';

/** A file pdf.js may ask for: a plain name, nothing that could reach another folder. */
export const PICTURE_ASSET_NAME = /^[A-Za-z0-9_.-]{1,80}$/u;

/** What the main process gives the import for a drawn document. */
export type PicturesResult =
  | {
      ok: true;
      width: number;
      height: number;
      /** Each page drawn, in order: which page it is (from 0), its PNG on disk and its comments. */
      pages: { index: number; file: string; notes: string }[];
      /** Pages in the document (more than were drawn when it is over the limit). */
      total: number;
      failed: number[];
    }
  | { ok: false; message: string };

/**
 * Where a page goes on the canvas: as large as fits, in the middle, keeping
 * its shape (black either side, or above and below, when the shapes differ).
 */
export function fitPage(
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
): { scale: number; x: number; y: number; w: number; h: number } {
  const scale = Math.min(width / pageWidth, height / pageHeight);
  const w = Math.round(pageWidth * scale);
  const h = Math.round(pageHeight * scale);
  return { scale, x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/** Notes as a slide keeps them: lines trimmed, runs of blank lines made one, at most 4,000 characters. */
export function tidyNotes(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 4000);
}
