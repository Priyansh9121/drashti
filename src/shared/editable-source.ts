import type { Rect, SlideElement } from './model';
import type { PictureJob, PicturePage, PicturesDone } from './pictures';

export const EDITABLE_SOURCE_LIMITS = {
  pages: 400,
  pageElements: 500,
  pageAssetBytes: 32 * 1024 * 1024,
  jobAssetBytes: 128 * 1024 * 1024,
  pageMetadataBytes: 2 * 1024 * 1024,
  jobMetadataBytes: 16 * 1024 * 1024,
  pending: 4,
  timeoutMs: 180_000,
} as const;

export interface EditablePdfJob {
  mode: 'editable-source';
  jobId: string;
  data: Uint8Array;
  sourcePages: number[];
  limits: typeof EDITABLE_SOURCE_LIMITS;
  /** Time left when the hidden renderer claims the job. */
  timeBudgetMs: number;
}
export interface EditablePdfPageWire {
  mode: 'editable-source';
  jobId: string;
  sourceIndex: number;
  width: number;
  height: number;
  elements: SlideElement[];
  assets: { token: string; png: Uint8Array }[];
  issues: string[];
}
export interface EditablePdfCheckpoint {
  mode: 'editable-checkpoint';
  jobId: string;
  sourceIndex: number;
  /** Count from the opened PDF, so Main can report an interrupted preparation. */
  total?: number;
}
export interface EditablePdfDone {
  mode: 'editable-source';
  jobId: string;
  total: number;
  failed: number[];
  // Controlled product text only; never an exception/document filename/source text.
  error?: string;
}
export type PdfJob = PictureJob | EditablePdfJob;
export type PdfPage = PicturePage | EditablePdfPageWire | EditablePdfCheckpoint;
export type PdfDone = PicturesDone | EditablePdfDone;

/** Prepared PPTX object whose picture is taken from this occurrence’s retained source slide. */
export const RETAINED_SLIDE_PICTURE = 'retained-slide-picture';

export function pptxAssetTokens(elements: readonly SlideElement[]): Set<string> {
  return new Set(
    elements.flatMap((element) =>
      (element.kind === 'image' && element.mediaId !== RETAINED_SLIDE_PICTURE) || element.kind === 'video'
        ? [element.mediaId]
        : [],
    ),
  );
}

export function sourcePictureRegion(frame: Rect, size: { width: number; height: number }) {
  const within = (start: number, length: number, whole: number) => {
    const left = Math.max(0, start);
    const right = Math.min(whole, start + length);
    if (!(right > left)) return null;
    // A small amount of surrounding pixels keeps narrow drawings inside the supported crop range.
    const span = Math.max(right - left, whole * 0.010001);
    return { start: Math.max(0, Math.min(whole - span, (left + right - span) / 2)), span };
  };
  const x = within(frame.x, frame.width, size.width);
  const y = within(frame.y, frame.height, size.height);
  if (!x || !y) return null;
  return {
    frame: { x: x.start, y: y.start, width: x.span, height: y.span },
    crop: {
      x: x.start / size.width,
      y: y.start / size.height,
      width: x.span / size.width,
      height: y.span / size.height,
    },
  };
}

/** Main-only generated file locations; never returned as paths chosen by the hidden renderer. */
export interface PreparedSourcePage {
  sourceIndex: number;
  width: number;
  height: number;
  background: string | null;
  elements: SlideElement[];
  assets: { token: string; file: string; kind: 'image' | 'video' | 'audio' }[];
  issues: string[];
}
export type PreparedSource =
  | { ok: true; pages: PreparedSourcePage[]; total: number; failed: number[] }
  | { ok: false; message: string; retainOutput?: true };
