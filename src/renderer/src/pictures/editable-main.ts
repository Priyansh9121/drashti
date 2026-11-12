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
  let stopped = false;
  let error: string | undefined;
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
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (
            !(await window.drashti.pictures.page({
              mode: 'editable-checkpoint',
              jobId: job.jobId,
              sourceIndex,
              total,
            }))
          ) {
            stopped = true;
            throw new Error('Editable source preparation stopped.');
          }
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
        jobBytes += assets.reduce((sum, asset) => sum + asset.png.byteLength, 0);
      } catch {
        failed.push(sourceIndex);
      } finally {
        page?.cleanup();
      }
      if (stopped) break;
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
