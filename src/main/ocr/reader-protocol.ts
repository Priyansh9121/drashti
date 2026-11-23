import type { OcrFiles } from './ocr-engine';

/*
 * What Main and the reading process (ocr-worker.ts) say to each other (book OCR, alpha.21): one job, the pictures'
 * files in order, then the reader's word as it goes. Main stops the process to stop a reading.
 */

/** The process's name, as the system's process list and Electron's metrics show it. */
export const READER_SERVICE_NAME = 'Drashti words reader';

export interface ReaderJob {
  files: OcrFiles;
  /** The pictures to read, in order (PNG, JPEG, TIFF, WebP, GIF or BMP files). */
  pages: string[];
}

export type ReaderSays =
  | { kind: 'starting'; fraction: number }
  | { kind: 'reading'; page: number; fraction: number }
  | { kind: 'page'; page: number; text: string }
  | { kind: 'done' }
  /** Page `page` (from 0) could not be read as a picture; `null`: the reader itself could not start. */
  | { kind: 'failed'; page: number | null };

/** Whether a message is one the reading process sends. */
export function isReaderSays(m: unknown): m is ReaderSays {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Record<string, unknown>;
  const fraction = typeof r['fraction'] === 'number' && r['fraction'] >= 0 && r['fraction'] <= 1;
  const page = Number.isInteger(r['page']) && (r['page'] as number) >= 0;
  switch (r['kind']) {
    case 'starting':
      return fraction;
    case 'reading':
      return fraction && page;
    case 'page':
      return page && typeof r['text'] === 'string';
    case 'done':
      return true;
    case 'failed':
      return r['page'] === null || page;
    default:
      return false;
  }
}
