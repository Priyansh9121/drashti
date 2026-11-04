// Reads the actual retained source and runs the same extraction cores; no known-word lookup or fake elements.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { EDITABLE_SOURCE_LIMITS, type PreparedSourcePage } from '../../../shared/editable-source';
import { editablePdfPage } from '../../../shared/pdf-edit-page';
import type { SourceReader } from '../../documents/source-reader';
import { readEditablePptx } from '../deck/editable-pptx';
import { MEDIA_REF } from '../model';

const require = createRequire(import.meta.url);
export const nativeSourceReader: SourceReader = async (request) => {
  const isAborted = (): boolean => request.signal.aborted;
  if (isAborted() || !(await request.checkpoint())) return { ok: false, message: 'Cancelled.' };
  await mkdir(request.outDir, { recursive: true });
  const pages: PreparedSourcePage[] = [];
  const failed: number[] = [];
  if (request.ext === 'pptx') {
    const native = await readEditablePptx(request.file, request.outDir);
    for (const sourceIndex of request.sourcePages) {
      if (isAborted() || !(await request.checkpoint())) return { ok: false, message: 'Cancelled.' };
      const page = native.slides.find((entry) => entry.sourceIndex === sourceIndex);
      if (!page) {
        failed.push(sourceIndex);
        continue;
      }
      const tokens = new Set(
        page.elements.flatMap((element) =>
          element.kind === 'image' || element.kind === 'video' ? [element.mediaId] : [],
        ),
      );
      pages.push({
        sourceIndex,
        width: native.width,
        height: native.height,
        background: page.background,
        elements: page.elements,
        issues: page.issues,
        assets: native.media.flatMap((asset, index) => {
          const token = `${MEDIA_REF}${String(index)}`;
          return tokens.has(token) ? [{ token, file: asset.originalPath, kind: asset.kind }] : [];
        }),
      });
    }
    return { ok: true, pages, total: native.slides.length, failed };
  }
  // Uses the installed Node canvas only in unit tests. Production PDF uses bundled DOM renderer/data.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
  const assets = dirname(require.resolve('pdfjs-dist/package.json'));
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await readFile(request.file)),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: false,
    standardFontDataUrl: join(assets, 'standard_fonts') + sep,
    cMapUrl: join(assets, 'cmaps') + sep,
    cMapPacked: true,
    wasmUrl: join(assets, 'wasm') + sep,
  });
  try {
    const pdf = await loading.promise;
    for (const sourceIndex of request.sourcePages) {
      const page = await pdf.getPage(sourceIndex + 1);
      try {
        const native = await editablePdfPage(pdf, page, pdfjs.OPS, {
          checkpoint: async () => {
            if (isAborted() || !(await request.checkpoint())) throw new Error('Cancelled.');
          },
          maxAssetBytes: EDITABLE_SOURCE_LIMITS.pageAssetBytes,
        });
        const generated: PreparedSourcePage['assets'] = [];
        for (const asset of native.assets) {
          const file = join(request.outDir, `${randomUUID()}.png`);
          await writeFile(file, asset.png, { flag: 'wx', mode: 0o600 });
          generated.push({ token: asset.id, file, kind: 'image' });
        }
        pages.push({
          sourceIndex,
          width: native.width,
          height: native.height,
          background: '#ffffff',
          elements: native.elements,
          assets: generated,
          issues: native.issues,
        });
      } finally {
        page.cleanup();
      }
    }
    return { ok: true, pages, total: pdf.numPages, failed };
  } finally {
    await loading.destroy();
  }
};
