import { getDocument, OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { EditablePdfJob } from '../../../shared/editable-source';
import { editablePdfPage } from '../../../shared/pdf-edit-page';
import type { PictureAssetKind } from '../../../shared/pictures';

type BinaryDataFactory = new () => {
  fetch(input: { kind: PictureAssetKind; filename: string }): Promise<Uint8Array>;
};

const MAX_PAGE_MS = 8_000;
const PDF_CLEANUP_MS = 250;
/*
 * How this window shares the processor as it prepares the pages (Session 57). Main runs it at the lowest priority;
 * besides, after each WORK_SLICE_MS of work it gives way for GIVE_WAY_MS and asks Main whether it may go on (Main asks
 * again as it takes each page). It did both at each of a page's small steps (about ten a page), so a big PDF's opening
 * was mostly waiting: the generated 100-page PDF stayed at "Opening the slides…" past 30 s on CI's Mac.
 */
const WORK_SLICE_MS = 50;
const GIVE_WAY_MS = 10;

export async function drawEditablePdf(
  job: EditablePdfJob,
  BinaryDataFactory: BinaryDataFactory,
): Promise<void> {
  const finishBy = performance.now() + Math.max(0, job.timeBudgetMs - PDF_CLEANUP_MS);
  const task = getDocument({
    data: job.data,
    BinaryDataFactory,
    standardFontDataUrl: 'drashti/',
    wasmUrl: 'drashti/',
    cMapUrl: 'drashti/',
    cMapPacked: true,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: false,
    isOffscreenCanvasSupported: true,
  });
  let total = 0;
  const failed: number[] = [];
  let jobBytes = 0;
  const preparation = { stopped: false };
  let error: string | undefined;
  // When this window last gave way, and when Main last said it may go on (null: not asked yet).
  let gaveWayAt = performance.now();
  let answeredAt: number | null = null;
  try {
    const doc = await task.promise;
    total = doc.numPages;
    for (const [position, sourceIndex] of job.sourcePages.entries()) {
      const start = performance.now();
      const remainingMs = finishBy - start;
      if (remainingMs <= 0) {
        failed.push(...job.sourcePages.slice(position));
        break;
      }
      const pageEnds = start + Math.min(MAX_PAGE_MS, remainingMs / (job.sourcePages.length - position));
      const checkTime = () => {
        if (performance.now() >= pageEnds) throw new Error('This page took too long to prepare.');
      };
      let page: PDFPageProxy | undefined;
      try {
        const checkpoint = async () => {
          checkTime();
          if (performance.now() - gaveWayAt >= WORK_SLICE_MS) {
            await new Promise((resolve) => setTimeout(resolve, GIVE_WAY_MS));
            gaveWayAt = performance.now();
          } else if (answeredAt !== null && performance.now() - answeredAt < WORK_SLICE_MS) return;
          // The first one also tells Main the page count.
          if (
            !(await window.drashti.pictures.page({
              mode: 'editable-checkpoint',
              jobId: job.jobId,
              sourceIndex,
              total,
            }))
          ) {
            preparation.stopped = true;
            throw new Error('Editable source preparation stopped.');
          }
          answeredAt = performance.now();
          checkTime();
        };
        await checkpoint();
        page = await doc.getPage(sourceIndex + 1);
        const native = await editablePdfPage(doc, page, OPS, {
          checkpoint,
          maxAssetBytes: Math.min(job.limits.pageAssetBytes, job.limits.jobAssetBytes - jobBytes),
        });
        checkTime();
        const assets = native.assets.map(({ id, png }) => ({ token: id, png }));
        if (
          !(await window.drashti.pictures.page({
            mode: 'editable-source',
            jobId: job.jobId,
            sourceIndex,
            width: native.width,
            height: native.height,
            elements: native.elements,
            assets,
            issues: native.issues,
          }))
        )
          break;
        // Main checked again as it took the page.
        answeredAt = performance.now();
        jobBytes += assets.reduce((sum, asset) => sum + asset.png.byteLength, 0);
      } catch {
        failed.push(sourceIndex);
      } finally {
        page?.cleanup();
      }
      if (preparation.stopped) break;
    }
  } catch {
    error = 'This PDF could not be prepared safely. Saved playback is unchanged.';
  } finally {
    // Destroy first: no live PDF callbacks may outlast the terminal reply/window cleanup.
    await task.destroy().catch(() => undefined);
  }
  await window.drashti.pictures.done({
    mode: 'editable-source',
    jobId: job.jobId,
    total,
    failed,
    ...(error ? { error } : {}),
  });
}
