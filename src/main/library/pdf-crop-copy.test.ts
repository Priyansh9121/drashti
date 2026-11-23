import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfOperatorWords } from './testing/pdf-operator-words';
import { makeTestPdf } from '../import/testing/make-pdf';
import { cropPdfCopy } from '../../shared/pdf-crop-copy';
it('writes a true CropBox, retaining MediaBox, content outside it and every uncropped page', async () => {
  const data = new Uint8Array(
    makeTestPdf([
      { width: 400, height: 600, color: [50, 70, 90], text: 'Placeholder outside crop' },
      { width: 600, height: 400, color: [90, 70, 50], text: 'Placeholder whole page' },
    ]),
  );
  const before = data.slice();
  const copy = await cropPdfCopy(data, [{ x: 0.25, y: 0.1, w: 0.5, h: 0.2 }, undefined]);
  expect(data).toEqual(before);
  const loading = getDocument({ data: copy.slice(), useSystemFonts: false });
  try {
    const doc = await loading.promise;
    expect(doc.numPages).toBe(2);
    const first = await doc.getPage(1),
      second = await doc.getPage(2);
    expect(first.view).toEqual([100, 420, 300, 540]);
    expect(first.getViewport({ scale: 1 }).width).toBe(200);
    expect(first.getViewport({ scale: 1 }).height).toBe(120);
    expect(second.view).toEqual([0, 0, 600, 400]);
    expect(await pdfOperatorWords(first)).toContain('Placeholder outside crop');
    expect(
      (await first.getTextContent()).items
        .filter((i) => 'str' in i)
        .map((i) => ('str' in i ? i.str : ''))
        .join(' '),
    ).not.toContain('Placeholder outside crop');
    // PDF.js public view honors CropBox; the saved page still has its original media extents in the output.
    expect(new TextDecoder().decode(copy)).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+400\s+600\s*\]/);
  } finally {
    await loading.destroy();
  }
});

/** A generated page with positive origin and an existing CropBox, including inherited rotation. */
function turnedPdf(rotation: number): Uint8Array {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate ${rotation} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /CropBox [10 20 410 620] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, body] of bodies.entries()) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
for (const [rotation, view] of [
  [0, [50, 260, 170, 500]],
  [90, [90, 80, 250, 260]],
  [180, [250, 140, 370, 380]],
  [270, [170, 380, 330, 560]],
] as const) {
  it(`maps the crop from displayed coordinates through ${rotation} degrees and an existing offset CropBox`, async () => {
    const copy = await cropPdfCopy(turnedPdf(rotation), [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
    const loading = getDocument({ data: copy, useSystemFonts: false });
    try {
      const page = await (await loading.promise).getPage(1);
      expect(page.rotate).toBe(rotation);
      expect(page.view).toEqual(view);
    } finally {
      await loading.destroy();
    }
  });
}

it('the independent operator-list oracle reads retained words that CropBox hides from text extraction', async () => {
  const paint = 'BT /F1 18 Tf 40 40 Td (Placeholder hidden words) Tj ET';
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /CropBox [100 420 300 540] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${paint.length} >>\nstream\n${paint}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of bodies.entries()) {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const loading = getDocument({ data: new TextEncoder().encode(source), useSystemFonts: false });
  try {
    const page = await (await loading.promise).getPage(1);
    expect(page.view).toEqual([100, 420, 300, 540]);
    expect((await page.getTextContent()).items).toHaveLength(0);
    expect(await pdfOperatorWords(page)).toBe('Placeholder hidden words');
  } finally {
    await loading.destroy();
  }
});
