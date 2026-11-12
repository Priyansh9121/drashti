import { nodePdfAssets } from '../import/testing/pdfjs-assets';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editablePdfPage } from '../../shared/pdf-edit-page';
import {
  clippedGlyphsPdf,
  clippedWordsPdf,
  maskedWordsPdf,
  PDF_EDITABLE_WORDS,
} from './testing/pdf-native-effects';

const require = createRequire(import.meta.url);
const pdfPackage = require.resolve('pdfjs-dist/package.json');
let pdfjs: typeof PdfJs;
let oldWorker: PropertyDescriptor | undefined;

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'pdfjsWorker');
  Object.defineProperty(globalThis, 'pdfjsWorker', { configurable: true, writable: true, value: worker });
});

afterAll(() => {
  if (oldWorker) Object.defineProperty(globalThis, 'pdfjsWorker', oldWorker);
  else Reflect.deleteProperty(globalThis, 'pdfjsWorker');
});

async function withPage(
  bytes: Buffer,
  use: (doc: PDFDocumentProxy, page: PDFPageProxy) => Promise<void>,
): Promise<void> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    ...nodePdfAssets(dirname(pdfPackage)),
  });
  try {
    const doc = await task.promise;
    await use(doc, await doc.getPage(1));
  } finally {
    await task.destroy();
  }
}

async function centerPixel(png: Uint8Array): Promise<number[]> {
  // Use the same Node canvas package PDF.js uses, resolved from PDF.js itself.
  const canvas = createRequire(pdfPackage)('@napi-rs/canvas') as {
    loadImage(bytes: Buffer): Promise<{ width: number; height: number }>;
    createCanvas(
      width: number,
      height: number,
    ): {
      getContext(type: '2d'): {
        drawImage(image: object, x: number, y: number): void;
        getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
      };
    };
  };
  const image = await canvas.loadImage(Buffer.from(png));
  const ctx = canvas.createCanvas(image.width, image.height).getContext('2d');
  ctx.drawImage(image, 0, 0);
  return [...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data];
}

describe('editing generated PDF pages with clipping and masks', () => {
  it('keeps clipped graphics as pictures on both sides of editable words in paint order', async () => {
    await withPage(clippedWordsPdf(), async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      expect(list.fnArray).toContain(pdfjs.OPS.clip);
      expect(list.fnArray).toContain(pdfjs.OPS.eoClip);

      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toMatchObject([
        { kind: 'image', frame: { x: 10, y: 118, width: 25, height: 30 } },
        { kind: 'text', text: PDF_EDITABLE_WORDS },
        { kind: 'image', frame: { x: 70, y: 116, width: 30, height: 20 } },
      ]);
      const [below, above] = result.assets;
      if (!below || !above) throw new Error('Clipped paint was not retained.');
      expect(await centerPixel(below.png)).toEqual([255, 0, 0, 255]);
      expect(await centerPixel(above.png)).toEqual([0, 255, 0, 255]);
    });
  });

  it('keeps alpha-masked paint as a translucent picture and the other words editable', async () => {
    await withPage(maskedWordsPdf(), async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      expect(list.fnArray).toContain(pdfjs.OPS.beginGroup);
      expect(
        list.fnArray.some((fn, index) => {
          const args: unknown = list.argsArray[index];
          return (
            fn === pdfjs.OPS.setGState &&
            Array.isArray(args) &&
            Array.isArray(args[0]) &&
            args[0].some(
              (entry: unknown) => Array.isArray(entry) && entry[0] === 'SMask' && entry[1] !== false,
            )
          );
        }),
      ).toBe(true);

      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toMatchObject([
        { kind: 'image', frame: { x: 30, y: 100, width: 60, height: 40 } },
        { kind: 'text', text: PDF_EDITABLE_WORDS },
      ]);
      expect(result.assets).toHaveLength(1);
      const asset = result.assets[0];
      if (!asset) throw new Error('Masked paint was not retained.');
      const pixel = await centerPixel(asset.png);
      expect(pixel.slice(0, 3)).toEqual([0, 0, 255]);
      expect(pixel[3]).toBeGreaterThanOrEqual(126);
      expect(pixel[3]).toBeLessThanOrEqual(129);
    });
  });

  it('keeps text whose glyphs are cut by a clip in a picture', async () => {
    await withPage(clippedGlyphsPdf(), async (doc, page) => {
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toMatchObject([{ kind: 'image' }]);
      expect(result.elements[0]?.frame.width).toBeLessThanOrEqual(18);
      expect(result.assets).toHaveLength(1);
    });
  });
});
