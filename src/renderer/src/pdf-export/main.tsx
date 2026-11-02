import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import type { PictureAssetKind } from '../../../shared/pictures';
import type { PdfCopyJob, PdfPrintPage } from '../../../shared/pdf-copy';
import { SlideView } from '../render/SlideView';
import { preloadFonts } from '../render/fonts';
import '../render/fonts.css';
import '../styles/app.css';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

class BridgeDataFactory {
  async fetch({ kind, filename }: { kind: PictureAssetKind; filename: string }): Promise<Uint8Array> {
    const data = await window.drashti.pdfExport.asset(kind, filename);
    if (!data) throw new Error('An offline PDF resource is unavailable.');
    return data;
  }
}

function load(data: Uint8Array) {
  return getDocument({
    data: data.slice(),
    BinaryDataFactory: BridgeDataFactory,
    standardFontDataUrl: 'drashti/',
    cMapUrl: 'drashti/',
    cMapPacked: true,
    wasmUrl: 'drashti/',
    useWorkerFetch: false,
    useSystemFonts: false,
  });
}

async function printMetadata(data: Uint8Array): Promise<PdfPrintPage[]> {
  const loading = load(data);
  try {
    const doc = await loading.promise;
    if (doc.numPages !== 1) throw new Error('An edited page printed onto more than one sheet.');
    const page = await doc.getPage(1);
    if (!page.ref) throw new Error('The printed sheet has no page identity.');
    return [{ ref: page.ref, view: [...page.view], rotate: page.rotate }];
  } finally {
    await loading.destroy();
  }
}

async function dimensions(data: Uint8Array): Promise<{ width: number; height: number }[]> {
  const loading = load(data);
  try {
    const doc = await loading.promise;
    const sizes = [];
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return sizes;
  } finally {
    await loading.destroy();
  }
}

async function assemble(job: PdfCopyJob, printed: Map<number, Uint8Array>): Promise<Uint8Array> {
  const sources = new Map(job.sources.map((source) => [source.id, source.data]));
  const primary = job.sources[0]?.data ?? printed.values().next().value;
  if (!primary) throw new Error('There are no pages to export.');
  const loading = load(primary);
  try {
    const doc: PDFDocumentProxy = await loading.promise;
    const copiedSources = new Map<Uint8Array, Uint8Array>();
    const pages = job.pages.map((page, index) => {
      const data = page.kind === 'original' ? sources.get(page.sourceId) : printed.get(index);
      if (!data) throw new Error('A PDF source page is unavailable.');
      let external: Uint8Array | null = null;
      if (data !== primary) {
        external = copiedSources.get(data) ?? data.slice();
        copiedSources.set(data, external);
      }
      return {
        document: external,
        includePages: [page.kind === 'original' ? page.page : 0],
        pageIndices: [index],
      };
    });
    const result = await doc.extractPages(pages);
    if (!(result instanceof Uint8Array) || result.length === 0 || result.length > 64 * 1024 * 1024)
      throw new Error('The PDF copy is outside the supported size limit.');
    return result;
  } finally {
    await loading.destroy();
  }
}

async function draw(): Promise<void> {
  const job = await window.drashti.pdfExport.job();
  if (!job) return;
  const mount = document.getElementById('root');
  if (!mount) return;
  const root = createRoot(mount);
  const sheet = document.createElement('style');
  document.head.append(sheet);
  const printed = new Map<number, Uint8Array>();
  try {
    await preloadFonts();
    for (const [index, page] of job.pages.entries()) {
      if (page.kind !== 'native') continue;
      const { width, height } = page.slide;
      // Element geometry is in design pixels; one design unit is one PDF point.
      // Chromium uses 96 CSS pixels per inch and PDF uses 72 points per inch.
      sheet.textContent = `@page{size:${width}pt ${height}pt;margin:0}html,body,#root{margin:0;padding:0;width:${width}pt;height:${height}pt;overflow:hidden;background:white}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}`;
      flushSync(() =>
        root.render(
          <div style={{ transform: 'scale(1.3333333333333333)', transformOrigin: 'top left', width, height }}>
            <SlideView slide={page.slide} media="still" />
          </div>,
        ),
      );
      await document.fonts.ready;
      await Promise.all(
        [...mount.querySelectorAll('img')].map(async (image) => {
          await image.decode();
          if (!image.naturalWidth) throw new Error('A page picture is unavailable.');
        }),
      );
      const fresh = await window.drashti.pdfExport.print(job.id, index);
      if (!fresh) throw new Error('The edited page could not be printed.');
      const metadata = await printMetadata(fresh);
      const corrected = await window.drashti.pdfExport.normalized(job.id, index, metadata);
      if (!corrected) throw new Error('The printed page could not retain its exact paper size.');
      printed.set(index, corrected);
    }
    const data = await assemble(job, printed);
    const pages = await dimensions(data);
    await window.drashti.pdfExport.done({ id: job.id, data, pages });
  } catch {
    await window.drashti.pdfExport.done({
      id: job.id,
      error: 'The PDF copy could not be generated safely. Its original is unchanged.',
    });
  } finally {
    root.unmount();
    sheet.remove();
  }
}

void draw();
