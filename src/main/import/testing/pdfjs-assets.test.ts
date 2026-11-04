import { posix, win32 } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { nativePaintPdf } from './pdf-native-fixtures';
import { nodePdfAssets } from './pdfjs-assets';

let pdfjs: typeof PdfJs;
let workerBefore: PropertyDescriptor | undefined;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  workerBefore = Object.getOwnPropertyDescriptor(globalThis, 'pdfjsWorker');
  Object.defineProperty(globalThis, 'pdfjsWorker', { configurable: true, writable: true, value: worker });
});
afterAll(() => {
  if (workerBefore) Object.defineProperty(globalThis, 'pdfjsWorker', workerBefore);
  else Reflect.deleteProperty(globalThis, 'pdfjsWorker');
});

for (const { name, root, paths } of [
  { name: 'Windows', root: 'D:\\Drashti fixtures\\pdfjs-dist', paths: win32 },
  { name: 'POSIX', root: '/tmp/Drashti fixtures/pdfjs-dist', paths: posix },
]) {
  describe(`${name} Node asset directories accepted by real PDF.js`, () => {
    for (const key of ['standardFontDataUrl', 'cMapUrl', 'wasmUrl'] as const) {
      it(`loads a generated document with ${key}`, async () => {
        // Only the chosen factory parameter is supplied, so one invalid directory
        // cannot hide a failure in another. No source asset is needed by this PDF.
        const assets = nodePdfAssets(root, paths);
        const loading = pdfjs.getDocument({
          data: new Uint8Array(nativePaintPdf('rectangle')),
          useWorkerFetch: false,
          [key]: assets[key],
        });
        try {
          const doc = await loading.promise;
          expect(doc.numPages).toBe(1);
        } finally {
          await loading.destroy();
        }
      });
    }
  });
}
