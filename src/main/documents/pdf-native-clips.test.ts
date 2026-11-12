import { nodePdfAssets } from '../import/testing/pdfjs-assets';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editablePdfPage } from '../../shared/pdf-edit-page';
import { PresentationRepo } from '../db/presentations';
import { originalWorld } from '../import/testing/original-fixture';
import { ImportedSlides } from '../library/imported-slides';
import { editDocOf } from '../library/slides';
import type { PreparedSourcePage } from '../../shared/editable-source';
import type { SourceReader } from './source-reader';
import { sourceWrite } from './source-write';
import {
  clippedDeckPdf,
  clippedGlyphsPdf,
  clippedWordsPdf,
  formWordsPdf,
  maskedWordsPdf,
  PDF_EDITABLE_WORDS,
  PDF_GROUP_WORDS,
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

async function withPdf<T>(bytes: Buffer, use: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
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
    return await use(doc);
  } finally {
    await task.destroy();
  }
}

async function withPage(
  bytes: Buffer,
  use: (doc: PDFDocumentProxy, page: PDFPageProxy) => Promise<void>,
): Promise<void> {
  await withPdf(bytes, async (doc) => use(doc, await doc.getPage(1)));
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

function effectDeckPdf(paint: readonly string[][]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const kids: string[] = [];
  for (const commands of paint) {
    const body = [...commands, `0 0 0 rg BT /F1 24 Tf 1 0 0 1 36 1030 Tm (${PDF_EDITABLE_WORDS}) Tj ET`].join(
      '\n',
    );
    const contents = objects.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    const page = objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1920 1080] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    kids.push(`${page} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const xref = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    xref.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  return Buffer.from(
    `${pdf}xref\n0 ${xref.length}\n${xref.join('')}trailer\n<< /Root 1 0 R /Size ${xref.length} >>\nstartxref\n${pdf.length}\n%%EOF\n`,
  );
}

const smallPaint = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const x = 26 + (i % 10) * 176;
    const y = 50 + Math.floor(i / 10) * 180;
    return `q ${x} ${y} 24 18 re W n 1 0 0 rg ${x - 4} ${y - 4} 32 26 re f Q`;
  });

describe('long and complex generated PDFs', () => {
  it('keeps forty small effects editable on a generated 1920 by 1080 page', async () => {
    await withPage(effectDeckPdf([smallPaint(40)]), async (doc, page) => {
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result).toMatchObject({ width: 1920, height: 1080 });
      const images = result.elements.filter((element) => element.kind === 'image');
      expect(images).toHaveLength(40);
      expect(result.assets).toHaveLength(40);
      expect(result.elements).toContainEqual(
        expect.objectContaining({ kind: 'text', text: PDF_EDITABLE_WORDS }),
      );
      for (const [index, { frame }] of images.entries()) {
        const x = 26 + (index % 10) * 176;
        const y = 1080 - 50 - Math.floor(index / 10) * 180 - 18;
        expect(Math.abs(frame.x - x)).toBeLessThanOrEqual(1);
        expect(Math.abs(frame.y - y)).toBeLessThanOrEqual(1);
        expect(frame.width).toBeGreaterThanOrEqual(24);
        expect(frame.height).toBeGreaterThanOrEqual(18);
        expect(frame.width).toBeLessThanOrEqual(26);
        expect(frame.height).toBeLessThanOrEqual(20);
      }
      const last = result.assets.at(-1);
      if (!last) throw new Error('The generated clipped paint is missing.');
      expect(await centerPixel(last.png)).toEqual([255, 0, 0, 255]);
    });
  });

  it('measures preparation of a generated 100-page clipped document', async () => {
    const count = 100;
    const source = clippedDeckPdf(count);
    const from = performance.now();
    const measured = await withPdf(source, async (doc) => {
      expect(doc.numPages).toBe(count);
      let bytes = 0;
      let assets = 0;
      let slowest = 0;
      for (let number = 1; number <= count; number++) {
        const start = performance.now();
        const page = await doc.getPage(number);
        try {
          const result = await editablePdfPage(doc, page, pdfjs.OPS);
          expect(result.elements.some((element) => element.kind === 'text')).toBe(true);
          assets += result.assets.length;
          bytes += result.assets.reduce((sum, asset) => sum + asset.png.byteLength, 0);
        } finally {
          page.cleanup();
        }
        slowest = Math.max(slowest, performance.now() - start);
      }
      return { bytes, assets, slowest };
    });
    process.stdout.write(
      '[Editable PDF timing] ' +
        JSON.stringify({
          platform: process.platform,
          arch: process.arch,
          pages: count,
          widthPt: 480,
          heightPt: 270,
          inputBytes: source.length,
          assets: measured.assets,
          assetBytes: measured.bytes,
          elapsedMs: Math.round(performance.now() - from),
          slowestPageMs: Math.round(measured.slowest),
        }) +
        '\n',
    );
    expect(measured.assets).toBe(count * 4);
  });

  it('keeps the saved middle picture when that page exceeds its paint budget', async () => {
    const world = originalWorld();
    const fullPaint = Array.from(
      { length: 40 },
      () => 'q 0 0 1920 1080 re W n 0 0 1 rg 0 0 1920 1080 re f Q',
    );
    const source = effectDeckPdf([smallPaint(3), fullPaint, smallPaint(3)]);
    try {
      writeFileSync(world.source, source);
      const { id } = await world.importPdf({
        drawPdf: async (file, outDir) => {
          const drawn = await world.drawPdf(file, outDir);
          const page = drawn.pages[0];
          if (!page) throw new Error('Missing generated preview.');
          return { ...drawn, total: 3, pages: [0, 1, 2].map((index) => ({ ...page, index })) };
        },
      });
      const repo = new PresentationRepo(world.db);
      const rows = repo.content(id);
      if (!rows) throw new Error('Missing generated presentation.');
      const before = editDocOf(rows, 'Placeholder clipped deck').doc;
      const saved = before.groups.flatMap((group) => group.slides);
      expect(saved).toHaveLength(3);
      expect(saved[1]?.elements.map((element) => element.kind)).toEqual(['image']);

      // Feed the editor the real core’s per-page results as its private PDF worker does.
      const sourceReader: SourceReader = (request) =>
        withPdf(readFileSync(request.file), async (doc) => {
          const pages: PreparedSourcePage[] = [];
          const failed: number[] = [];
          for (const sourceIndex of request.sourcePages) {
            const page = await doc.getPage(sourceIndex + 1);
            try {
              const result = await editablePdfPage(doc, page, pdfjs.OPS);
              const assets = result.assets.map((asset) => {
                const file = join(request.outDir, String(sourceIndex) + '-' + asset.id + '.png');
                writeFileSync(file, asset.png);
                return { token: asset.id, file, kind: 'image' as const };
              });
              pages.push({ ...result, sourceIndex, assets, background: '#ffffff' });
            } catch {
              failed.push(sourceIndex);
            } finally {
              page.cleanup();
            }
          }
          return { ok: true, pages, total: doc.numPages, failed };
        });
      const reader = new ImportedSlides(world.db, world.mediaDir, {
        sourceReader,
        sourceWrite: sourceWrite(world.db),
      });
      const prepared = await reader.prepare(rows, before, 'placeholder-budget', {
        signal: new AbortController().signal,
        allowed: () => true,
      });
      const after = prepared.doc.groups.flatMap((group) => group.slides);
      for (const index of [0, 2]) {
        const words = after[index]?.elements.find((element) => element.kind === 'text');
        expect(words?.text).toBe(PDF_EDITABLE_WORDS);
      }
      expect(after[1]?.elements).toEqual(saved[1]?.elements);
      expect(after[1]?.background).toBe(saved[1]?.background);
      expect(prepared.issues).toContain(
        'Some source pages could not be prepared and stay as their saved pictures.',
      );
      expect(repo.content(id)).toEqual(rows);
      expect(readFileSync(world.source)).toEqual(source);
    } finally {
      world.clean();
    }
  });

  it.each([false, true])(
    'keeps form text and describes a transparency group (grouped %s)',
    async (grouped) => {
      await withPage(formWordsPdf(grouped), async (doc, page) => {
        const result = await editablePdfPage(doc, page, pdfjs.OPS);
        const words = result.elements.flatMap((element) => (element.kind === 'text' ? [element.text] : []));
        expect(words).toContain(PDF_EDITABLE_WORDS);
        if (grouped) {
          expect(words).not.toContain(PDF_GROUP_WORDS);
          expect(result.assets).toHaveLength(1);
          expect(
            result.issues.some((issue) =>
              /transparency group.*picture|picture.*transparency group/u.test(issue),
            ),
          ).toBe(true);
        } else {
          expect(words).toContain(PDF_GROUP_WORDS);
          expect(result.issues.some((issue) => issue.includes('transparency group'))).toBe(false);
        }
      });
    },
  );
});
