/* Independent PDF.js read/render oracle, intended tests/e2e/pdf-export-oracle.ts.
 * Validate this setup in its own oracle spec BEFORE relying on feature RED.
 * Node canvas/module/font failure is a fixture error, never a product failure.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfRasterPage {
  width: number;
  height: number;
  words: string;
  transform: number[];
  rasterWidth: number;
  rasterHeight: number;
  pixels: Uint8ClampedArray;
  png: Uint8Array;
}
export type PdfRect = [number, number, number, number];
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface OracleCanvasTarget {
  canvas: HTMLCanvasElement & { toBuffer(mime: 'image/png'): Uint8Array };
  context: CanvasRenderingContext2D;
}
interface OracleCanvasFactory {
  create(width: number, height: number): OracleCanvasTarget;
  destroy(target: OracleCanvasTarget): void;
}
const require = createRequire(join(process.cwd(), 'package.json'));
const normalized = (text: string) => text.normalize('NFC').replace(/\s/gu, '');
export const occurrences = (text: string, words: string) =>
  normalized(text).split(normalized(words)).length - 1;

export async function inspectPdf(file: string): Promise<PdfRasterPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const loading = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: false,
    standardFontDataUrl: join(root, 'standard_fonts') + sep,
    cMapUrl: join(root, 'cmaps') + sep,
    cMapPacked: true,
    wasmUrl: join(root, 'wasm') + sep,
  });
  try {
    const pdf = await loading.promise;
    return await rasterPages(pdf, pdfjs.AnnotationMode.ENABLE);
  } finally {
    await loading.destroy();
  }
}

async function rasterPages(pdf: PDFDocumentProxy, annotationMode: number): Promise<PdfRasterPage[]> {
  const pages: PdfRasterPage[] = [];
  // The existing installed PDF.js Node canvas factory, not a new producer SDK.
  const factory = pdf.canvasFactory as OracleCanvasFactory;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ disableNormalization: true });
    const w = Math.ceil(viewport.width),
      h = Math.ceil(viewport.height);
    const target = factory.create(w, h);
    try {
      await page.render({ canvas: target.canvas, viewport, annotationMode, background: '#ffffff' }).promise;
      pages.push({
        width: viewport.width,
        height: viewport.height,
        words: content.items
          .filter((item): item is typeof item & { str: string } => 'str' in item)
          .map((item) => item.str)
          .join('\n'),
        transform: [...viewport.transform],
        rasterWidth: w,
        rasterHeight: h,
        pixels: new Uint8ClampedArray(target.context.getImageData(0, 0, w, h).data),
        png: new Uint8Array(target.canvas.toBuffer('image/png')),
      });
    } finally {
      factory.destroy(target);
    }
  }
  return pages;
}

/** ROI derived from the known reference page, so baked rotation and /Rotate are both valid. */
export function pdfRectInRaster(page: PdfRasterPage, rect: PdfRect): PixelRect {
  const [a, b, c, d, e, f] = page.transform;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined
  )
    throw new Error('Fixture viewport matrix is incomplete.');
  const point = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  const points = [
    point(rect[0], rect[1]),
    point(rect[2], rect[1]),
    point(rect[0], rect[3]),
    point(rect[2], rect[3]),
  ];
  const x = Math.floor(Math.min(...points.map((p) => p[0])));
  const y = Math.floor(Math.min(...points.map((p) => p[1])));
  return {
    x,
    y,
    width: Math.ceil(Math.max(...points.map((p) => p[0]))) - x,
    height: Math.ceil(Math.max(...points.map((p) => p[1]))) - y,
  };
}
function rgbaAt(data: ArrayLike<number>, offset: number): [number, number, number, number] {
  const r = data[offset],
    g = data[offset + 1],
    b = data[offset + 2],
    a = data[offset + 3];
  if (r === undefined || g === undefined || b === undefined || a === undefined)
    throw new Error('Fixture pixel data is incomplete.');
  return [r, g, b, a];
}
export function pixelsIn(page: PdfRasterPage, rect: PixelRect): number[] {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > page.rasterWidth ||
    rect.y + rect.height > page.rasterHeight
  )
    throw new Error('Fixture pixel region is outside its known page.');
  const result: number[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * page.rasterWidth + x) * 4;
      result.push(...rgbaAt(page.pixels, i));
    }
  return result;
}
export function whiteInk(rgba: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = rgbaAt(rgba, i);
    if (r > 230 && g > 230 && b > 230) total++;
  }
  return total;
}
export function maximumDifference(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('Pixel regions have different sizes.');
  return left.reduce((worst, value, i) => {
    const other = right[i];
    if (other === undefined) throw new Error('Fixture pixel data is incomplete.');
    return Math.max(worst, Math.abs(value - other));
  }, 0);
}
