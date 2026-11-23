/*
 * Book OCR (alpha.21, the owner's Q60-58: "A, Tesseract inside"): New presentation's Read Words from a Page… reads
 * the words of scanned pages (pictures, or a PDF's pages) with Tesseract inside Drashti, into the words box, to be
 * read over before Make slides.
 */

/** At most this many pages in one reading (a kirtan is a page or a few). */
export const READ_WORDS_MAX_PAGES = 20;

/** The picture files Tesseract reads, by their names' endings. */
export const READ_WORDS_PICTURES = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'gif', 'bmp'] as const;

/** What was chosen to read: pictures (read at once), a PDF (its pages asked for next), or nothing. */
export type ReadWordsChoice =
  | { ok: true; kind: 'pictures'; names: string[] }
  | { ok: true; kind: 'pdf'; name: string }
  | { ok: false; cancelled: true }
  | { ok: false; message: string };

/** A reading's words, each page's after the last's (a blank line between), or why there are none. */
export type ReadWordsResult =
  { ok: true; text: string; pages: number } | { ok: false; message: string; stopped?: true };

/** How a reading goes, for its progress bar. */
export interface ReadWordsProgress {
  /** Drawing a PDF's pages, starting the reader, or reading page `page` (from 1) of `pages`. */
  stage: 'drawing' | 'starting' | 'reading';
  page: number;
  pages: number;
  /** The whole reading, from 0 to 1. */
  fraction: number;
}

/** The note after a reading. */
export const readWordsDone = (pages: number): string =>
  pages === 1
    ? 'Read 1 page. Check the words against the page before you make the slides.'
    : `Read ${String(pages)} pages. Check the words against the pages before you make the slides.`;

export const READ_WORDS_STOPPED = 'Reading stopped: no words were added.';
