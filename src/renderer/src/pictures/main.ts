import { AnnotationMode, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import type { PictureAssetKind } from '../../../shared/pictures';
import { fitPage, tidyNotes } from '../../../shared/pictures';

/*
 * The hidden window that draws a PDF's pages as pictures (Session 15): each
 * page fitted into the canvas size on black, as a PNG, with the page's
 * comments (sticky notes) as its notes. One page at a time, handed to the
 * main process as each is done; the main process runs this window's process
 * at the lowest priority, so it never takes from the show.
 */

// pdf.js parses in this page, not in a worker: a worker script cannot be started from a page on disk.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

/** pdf.js's own data (fonts a PDF names without embedding them, its decoders), through the bridge. */
class BridgeDataFactory {
  async fetch({ kind, filename }: { kind: PictureAssetKind; filename: string }): Promise<Uint8Array> {
    const data = await window.drashti.pictures.asset(kind, filename);
    if (!data) throw new Error(`No ${kind} ${filename}`);
    return data;
  }
}

const canvasPng = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('The page could not be made into a picture.'));
      else void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, 'image/png');
  });

/** A page's comments: what its sticky notes say, in the order they are on the page. */
async function commentsOf(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const annotations = (await page.getAnnotations()) as { subtype?: string; contentsObj?: { str?: string } }[];
  return tidyNotes(
    annotations
      .filter((a) => a.subtype === 'Text' || a.subtype === 'FreeText')
      .map((a) => a.contentsObj?.str ?? '')
      .filter((text) => text.trim() !== '')
      .join('\n\n'),
  );
}

async function draw(): Promise<void> {
  const job = await window.drashti.pictures.job();
  if (!job) return;
  const task = getDocument({
    data: job.data,
    // pdf.js's own data comes through the bridge: these name no place (it never fetches), they only
    // say the data is there. Fonts a PDF names without embedding are the computer's own.
    BinaryDataFactory: BridgeDataFactory,
    standardFontDataUrl: 'drashti/',
    wasmUrl: 'drashti/',
    useWorkerFetch: false,
    isOffscreenCanvasSupported: true,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    await window.drashti.pictures.done({
      total: 0,
      failed: [],
      error:
        name === 'PasswordException'
          ? 'The PDF is protected with a password: save a copy without one and import that.'
          : 'The PDF could not be read: it may be damaged. Save it again from the program that made it.',
    });
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const failed: number[] = [];
  const count = Math.min(doc.numPages, job.maxPages);
  if (!ctx) {
    await window.drashti.pictures.done({ total: doc.numPages, failed: [], error: 'Nothing to draw with.' });
    return;
  }
  for (let i = 0; i < count; i++) {
    try {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const at = fitPage(base.width, base.height, job.width, job.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, job.width, job.height);
      // The page itself on white (as it prints), then its content.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(at.x, at.y, at.w, at.h);
      await page.render({
        canvas,
        canvasContext: ctx,
        viewport: page.getViewport({ scale: at.scale }),
        transform: [1, 0, 0, 1, at.x, at.y],
        // As it prints: drawn straight through (a hidden window has no animation frames to wait for).
        intent: 'print',
        // Comments are notes, not part of the picture.
        annotationMode: AnnotationMode.DISABLE,
      }).promise;
      const png = await canvasPng(canvas);
      const notes = await commentsOf(doc, i + 1);
      page.cleanup();
      if (!(await window.drashti.pictures.page({ index: i, png, notes }))) break;
    } catch {
      failed.push(i);
    }
    // A moment between pages: this window's process never holds on to the processor.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await window.drashti.pictures.done({ total: doc.numPages, failed });
  await task.destroy();
}

void draw();
