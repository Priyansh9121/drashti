import { generatedWordSubsetPdf } from '../../../tests/fixtures/pdf-word-subset';
import { nodePdfAssets } from '../import/testing/pdfjs-assets';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { editablePdfPage } from '../../shared/pdf-edit-page';

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

function paragraphPdf(
  content = 'BT /F1 12 Tf 20 180 Td (Placeholder first line) Tj 0 -16 Td (Placeholder second line) Tj 0 -16 Td (Last words) Tj ET',
): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

it('real PDF.js extraction returns one editable paragraph, its leading and a bundled-font notice', async () => {
  const bytes = paragraphPdf();
  const original = bytes.slice();
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const loading = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    ...nodePdfAssets(root),
  });
  try {
    const doc = await loading.promise;
    const page = await doc.getPage(1);
    const result = await editablePdfPage(doc, page, pdfjs.OPS);
    const words = result.elements.filter((element) => element.kind === 'text');
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({
      text: 'Placeholder first line Placeholder second line Last words',
      style: { lineHeight: 16 / 12, fontFamily: 'Noto Sans' },
    });
    expect(result.assets).toHaveLength(0);
    expect(result.issues.join(' ')).toContain('Noto Sans Gujarati');
    expect(bytes).toEqual(original);
  } finally {
    await loading.destroy();
  }
});

it('reads editable words from an actual embedded Latin subset before Gujarati is added', async () => {
  const bytes = generatedWordSubsetPdf();
  expect(bytes.includes(Buffer.from('/FontFile2 6 0 R'))).toBe(true);
  expect(bytes.includes(Buffer.from('/BaseFont /AAAAAA+NotoSans'))).toBe(true);
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    ...nodePdfAssets(root),
  });
  try {
    const doc = await loading.promise;
    const page = await doc.getPage(1);
    const source = await page.getTextContent();
    expect(
      source.items
        .filter((item) => 'str' in item)
        .map((item) => ('str' in item ? item.str : ''))
        .join(''),
    ).toBe('Placeholder source letters');
    const result = await editablePdfPage(doc, page, pdfjs.OPS);
    expect(result.elements.filter((element) => element.kind === 'text')).toMatchObject([
      { text: 'Placeholder source letters', style: { fontFamily: 'Noto Sans' } },
    ]);
    expect(result.assets).toHaveLength(0);
  } finally {
    await loading.destroy();
  }
});

it('a rotated source word does not consume the next upright occurrence of the same word', async () => {
  const bytes = paragraphPdf(
    'BT /F1 12 Tf 0 1 -1 0 80 100 Tm (Placeholder) Tj ET BT /F1 12 Tf 1 0 0 1 20 180 Tm (Placeholder) Tj ET',
  );
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const loading = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    ...nodePdfAssets(root),
  });
  try {
    const doc = await loading.promise;
    const result = await editablePdfPage(doc, await doc.getPage(1), pdfjs.OPS);
    const words = result.elements.filter((element) => element.kind === 'text');
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({ text: 'Placeholder', frame: { x: 20 } });
    expect(result.assets).toHaveLength(1);
  } finally {
    await loading.destroy();
  }
});
