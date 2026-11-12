import { nodePdfAssets } from '../import/testing/pdfjs-assets';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editablePdfPage } from '../../shared/pdf-edit-page';

const require = createRequire(import.meta.url);
const pdfPackage = require.resolve('pdfjs-dist/package.json');
const words = 'Placeholder editable words';
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
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

function stream(content: string, entries = ''): string {
  return '<< /Length ' + String(content.length) + entries + ' >>\nstream\n' + content + '\nendstream';
}

function placeholderPdf(content: string, resources = '', extraObjects: string[] = []): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >>' +
      resources +
      ' >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(content),
    ...extraObjects,
  ];
  let pdf = '%PDF-1.4\n';
  const rows = ['0000000000 65535 f \n'];
  for (const [index, body] of objects.entries()) {
    rows.push(String(pdf.length).padStart(10, '0') + ' 00000 n \n');
    pdf += String(index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  }
  const start = pdf.length;
  pdf +=
    'xref\n0 ' +
    String(rows.length) +
    '\n' +
    rows.join('') +
    'trailer\n<< /Size ' +
    String(rows.length) +
    ' /Root 1 0 R >>\nstartxref\n' +
    String(start) +
    '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii');
}

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
  const { loadImage, createCanvas } = createRequire(pdfPackage)('@napi-rs/canvas') as {
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
  const image = await loadImage(Buffer.from(png));
  const ctx = createCanvas(image.width, image.height).getContext('2d');
  ctx.drawImage(image, 0, 0);
  return [...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data];
}

const text = 'BT /F1 12 Tf 1 0 0 1 24 31 Tm (' + words + ') Tj ET';

describe('editing generated PDF pages with clipping and masks', () => {
  it('keeps clipped graphics as pictures on both sides of editable words in paint order', async () => {
    const source = placeholderPdf(
      'q 10 12 25 30 re W n 1 0 0 rg 0 0 140 80 re f Q\n' +
        text +
        '\nq 70 24 30 20 re W* n 0 1 0 rg 0 0 140 80 re f Q',
    );
    await withPage(source, async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      expect(list.fnArray).toContain(pdfjs.OPS.clip);
      expect(list.fnArray).toContain(pdfjs.OPS.eoClip);

      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toMatchObject([
        { kind: 'image', frame: { x: 10, y: 118, width: 25, height: 30 } },
        { kind: 'text', text: words },
        { kind: 'image', frame: { x: 70, y: 116, width: 30, height: 20 } },
      ]);
      const [below, above] = result.assets;
      if (!below || !above) throw new Error('Clipped paint was not retained.');
      expect(await centerPixel(below.png)).toEqual([255, 0, 0, 255]);
      expect(await centerPixel(above.png)).toEqual([0, 255, 0, 255]);
    });
  });

  it('keeps alpha-masked paint as a translucent picture and the other words editable', async () => {
    const source = placeholderPdf(
      'q /Masked gs 0 0 1 rg 0 10 140 80 re f Q\n' + text,
      ' /ExtGState << /Masked 6 0 R >>',
      [
        '<< /Type /ExtGState /SMask << /S /Alpha /G 7 0 R >> >>',
        stream(
          '/Half gs 0 0 0 rg 30 20 60 40 re f',
          ' /Type /XObject /Subtype /Form /BBox [0 0 240 160]' +
            ' /Group << /S /Transparency /CS /DeviceRGB /I true >>' +
            ' /Resources << /ExtGState << /Half << /Type /ExtGState /ca 0.5 >> >> >>',
        ),
      ],
    );
    await withPage(source, async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      expect(list.fnArray).toContain(pdfjs.OPS.beginGroup);
      expect(
        list.fnArray.some((fn, index) => {
          const args: unknown = list.argsArray[index];
          return (
            fn === pdfjs.OPS.setGState &&
            Array.isArray(args) &&
            Array.isArray(args[0]) &&
            args[0].some((entry: unknown) => Array.isArray(entry) && entry[0] === 'SMask' && entry[1] !== false)
          );
        }),
      ).toBe(true);

      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toMatchObject([
        { kind: 'image', frame: { x: 30, y: 100, width: 60, height: 40 } },
        { kind: 'text', text: words },
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
});
