import { nodePdfAssets } from './testing/pdfjs-assets';
// A PDF page's own words, pictures and shapes, as the editor reads them (pdf-edit-page.ts), from generated PDFs.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { editablePdfPage } from '../../shared/pdf-edit-page';
import { nativePaintPdf, OUTLINED_PLACEHOLDER } from './testing/pdf-native-fixtures';
import { makeTestPdf } from './testing/make-pdf';
import type { TestPdfPage } from './testing/make-pdf';

type PdfList = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
let pdfjs: typeof PdfJs;
let workerBefore: PropertyDescriptor | undefined;
const require = createRequire(import.meta.url);
const localAssets = dirname(require.resolve('pdfjs-dist/package.json'));

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

async function withSource<T>(
  bytes: Buffer,
  run: (doc: PDFDocumentProxy, page: PDFPageProxy) => Promise<T>,
): Promise<T> {
  const before = Buffer.from(bytes);
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
    // Node has no browser FontFace loader. Use PDF.js’s bundled glyph paths,
    // so retained ink never depends on an operating system’s fallback fonts.
    disableFontFace: true,
    stopAtErrors: true,
    ...nodePdfAssets(localAssets),
  });
  try {
    const doc = await loading.promise;
    expect(doc.numPages).toBe(1);
    return await run(doc, await doc.getPage(1));
  } finally {
    await loading.destroy();
    expect(bytes).toEqual(before);
  }
}

// Read real PDF.js v6 list data BEFORE page.render mutates the packed path into
// a Path2D. This is setup evidence, never a canned operator-list implementation.
function pathsBeforeRender(list: PdfList): { paint: number; commands: number[]; bounds: number[] }[] {
  const paths: { paint: number; commands: number[]; bounds: number[] }[] = [];
  for (const [index, fn] of list.fnArray.entries()) {
    if (fn !== pdfjs.OPS.constructPath) continue;
    const raw: unknown = list.argsArray[index];
    if (!Array.isArray(raw)) throw new Error('Real constructPath has no argument array.');
    const args: unknown[] = raw;
    const paint = args[0];
    const wrapped = args[1];
    const bounds = args[2];
    if (typeof paint !== 'number' || !Array.isArray(wrapped) || !(bounds instanceof Float32Array))
      throw new Error(
        'Installed PDF.js changed the v6 constructPath format; inspect it before changing this proof.',
      );
    const data: unknown = wrapped[0];
    if (!(data instanceof Float32Array)) throw new Error('Expected real packed DrawOPS before rendering.');
    paths.push({ paint, commands: [...data], bounds: [...bounds] });
  }
  return paths;
}
function hasBlend(list: PdfList, mode: string): boolean {
  return list.fnArray.some((fn, index) => {
    if (fn !== pdfjs.OPS.setGState) return false;
    const raw: unknown = list.argsArray[index];
    if (!Array.isArray(raw)) return false;
    const states: unknown = raw[0];
    return (
      Array.isArray(states) &&
      states.some((pair: unknown) => Array.isArray(pair) && pair[0] === 'BM' && pair[1] === mode)
    );
  });
}

function hasActiveSoftMask(list: PdfList): boolean {
  return list.fnArray.some((fn, index) => {
    if (fn !== pdfjs.OPS.setGState) return false;
    const raw: unknown = list.argsArray[index];
    if (!Array.isArray(raw)) return false;
    const states: unknown = raw[0];
    return (
      Array.isArray(states) &&
      states.some((pair: unknown) => Array.isArray(pair) && pair[0] === 'SMask' && pair[1] !== false)
    );
  });
}

describe('real PDF.js editable source paint, not operator mocks', () => {
  it('keeps an ordinary source rectangle as an editable native shape', async () => {
    await withSource(nativePaintPdf('rectangle'), async (doc, page) => {
      const paths = pathsBeforeRender(await page.getOperatorList({ annotationMode: 0 }));
      expect(paths).toEqual([
        {
          paint: pdfjs.OPS.fill,
          commands: [0, 40, 30, 1, 120, 30, 1, 120, 90, 1, 40, 90, 4],
          bounds: [40, 30, 120, 90],
        },
      ]);
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]).toMatchObject({
        kind: 'shape',
        fill: '#3366cc',
        opacity: 1,
        frame: { x: 40, y: 70, width: 80, height: 60 },
      });
      expect(result.elements.some((element) => element.kind === 'image')).toBe(false);
      expect(result.assets).toEqual([]);
    });
  });

  it('keeps the source cubic as a real native curve with control-inclusive normalized geometry', async () => {
    await withSource(nativePaintPdf('cubic'), async (doc, page) => {
      const paths = pathsBeforeRender(await page.getOperatorList({ annotationMode: 0 }));
      expect(paths).toEqual([
        {
          paint: pdfjs.OPS.fill,
          commands: [0, 20, 30, 2, 20, 90, 100, 90, 100, 30, 4],
          bounds: [20, 30, 100, 75],
        },
      ]);
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]).toMatchObject({
        kind: 'shape',
        shape: 'path',
        fill: '#993366',
        frame: { x: 20, y: 70, width: 80, height: 60 },
        path: {
          commands: [
            { op: 'M', x: 0, y: 1 },
            { op: 'C', x1: 0, y1: 0, x2: 1, y2: 0, x: 1, y: 1 },
            { op: 'Z' },
          ],
          fillRule: 'nonzero',
          lineCap: 'butt',
          lineJoin: 'miter',
        },
      });
      expect(result.elements.some((element) => element.kind === 'image')).toBe(false);
      expect(result.assets).toEqual([]);
    });
  });

  it('refuses the whole page when ordinary multiply bands depend on the earlier backdrop', async () => {
    await withSource(nativePaintPdf('multiply-bands'), async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      expect(pathsBeforeRender(list)).toHaveLength(3);
      expect(hasBlend(list, 'multiply')).toBe(true);
      // Ensure RED is not merely the existing transparency-group safeguard.
      expect(list.fnArray).not.toContain(pdfjs.OPS.beginGroup);
      // PDF.js6.4 represents SMask in setGState, not a beginSMaskGroup opcode.
      expect(hasActiveSoftMask(list)).toBe(false);
      await expect(editablePdfPage(doc, page, pdfjs.OPS)).rejects.toThrow(/composit|blend|separat|safely/iu);
    });
  });

  it('keeps fill-plus-stroke source words as a separate picture with an explicit editing limit', async () => {
    // Control: same real local font/words, ordinary Tr0, must be native. If this
    // fails first it is a fixture/font setup problem, not the intended outline RED.
    await withSource(nativePaintPdf('fill-text'), async (doc, page) => {
      const control = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(
        control.elements
          .filter((element) => element.kind === 'text')
          .map((element) => element.text)
          .join(''),
      ).toContain(OUTLINED_PLACEHOLDER);
    });
    await withSource(nativePaintPdf('fill-stroke-text'), async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      const modes = list.fnArray.flatMap((fn, index) => {
        if (fn !== pdfjs.OPS.setTextRenderingMode) return [];
        const args: unknown = list.argsArray[index];
        if (!Array.isArray(args)) return [];
        const mode: unknown = args[0];
        return [mode];
      });
      expect(modes).toContain(2);
      expect(list.fnArray).toContain(pdfjs.OPS.showText);
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      expect(result.elements.some((element) => element.kind === 'text')).toBe(false);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]).toMatchObject({ kind: 'image' });
      expect(result.assets).toHaveLength(1);
      expect(result.assets.every((asset) => asset.png.length > 0)).toBe(true);
      expect(
        result.issues.some((issue) => /outline|stroke/iu.test(issue) && /picture|retyp/iu.test(issue)),
      ).toBe(true);
    });
  });

  // The intersection keeps this valid against the current makeTestPdf signature,
  // so before the builder change RED is the absent genuine image paint assertion,
  // rather than a missing production interface/module.
  it('keeps a genuine generated embedded image after ordinary vector fills become native', async () => {
    const source: TestPdfPage & { syntheticImage: { x: number; y: number; width: number; height: number } } =
      {
        width: 960,
        height: 540,
        color: [30, 58, 138],
        text: 'Placeholder editable words',
        syntheticImage: { x: 800, y: 32, width: 96, height: 64 },
      };
    await withSource(makeTestPdf([source]), async (doc, page) => {
      const list = await page.getOperatorList({ annotationMode: 0 });
      const imageOps = new Set([
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintImageXObjectRepeat,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintInlineImageXObjectGroup,
      ]);
      expect(
        list.fnArray.some((fn) => imageOps.has(fn)),
        'the source PDF itself contains a genuine image paint, not only a colored rectangle',
      ).toBe(true);
      const result = await editablePdfPage(doc, page, pdfjs.OPS);
      const image = result.elements.find(
        (element) => element.kind === 'image' && element.frame.x === 800 && element.frame.y === 444,
      );
      if (image?.frame.width !== 96 || image.frame.height !== 64) {
        console.error(
          'Placeholder embedded-image numeric geometry',
          JSON.stringify({
            page: { width: result.width, height: result.height },
            elements: result.elements.map((element) => ({ kind: element.kind, frame: element.frame })),
            imagePaintIndices: list.fnArray.flatMap((fn, index) => (imageOps.has(fn) ? [index] : [])),
            assetSizes: result.assets.map((asset) => asset.png.byteLength),
          }),
        );
      }
      expect(
        image,
        'the embedded image remains a separately retained object after vector extraction',
      ).toMatchObject({
        kind: 'image',
        frame: { x: 800, y: 444, width: 96, height: 64 },
      });
      if (image?.kind !== 'image') throw new Error('The generated embedded image was not retained.');
      expect(result.assets.some((asset) => asset.id === image.mediaId && asset.png.byteLength > 0)).toBe(
        true,
      );
    });
  });
});
