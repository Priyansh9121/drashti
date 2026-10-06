/*
 * A PDF made for tests (Session 15): pages of one colour each, with a line
 * of placeholder words, and a comment (a sticky note) on the pages that are
 * given one, as a PDF's speaker notes. Written by hand, byte by byte, so the
 * tests need nothing that makes PDFs.
 */

export interface TestPdfPage {
  /** Points (1/72 inch): 960 × 540 is a 16:9 slide, 720 × 540 a 4:3 one. */
  width: number;
  height: number;
  /** The page's colour, 0 to 255 each. */
  color: [number, number, number];
  text?: string;
  /** A comment on the page (its notes). */
  note?: string;
}

/** PDF text strings: backslashes and brackets escaped, ASCII only. */
const pdfString = (text: string) =>
  `(${text.replace(/[\\()]/gu, (c) => `\\${c}`).replace(/[^\x20-\x7e]/gu, '?')})`;

export function makeTestPdf(pages: readonly TestPdfPage[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  // Numbers are kept in the order objects are added: catalog 1, pages 2, the font 3, then each page's.
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const page of pages) {
    const [r, g, b] = page.color.map((c) => (c / 255).toFixed(3));
    const lines = [`${r} ${g} ${b} rg`, `0 0 ${String(page.width)} ${String(page.height)} re f`];
    if (page.text)
      lines.push(
        '1 1 1 rg',
        'BT',
        '/F1 36 Tf',
        `48 ${String(Math.round(page.height / 2))} Td`,
        `${pdfString(page.text)} Tj`,
        'ET',
      );
    const content = lines.join('\n');
    const stream = add(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
    const annots = page.note
      ? ` /Annots [${String(add(`<< /Type /Annot /Subtype /Text /Rect [8 8 32 32] /Contents ${pdfString(page.note)} /Open false >>`))} 0 R]`
      : '';
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(page.width)} ${String(page.height)}] /Contents ${String(stream)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >>${annots} >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(' ')}] /Count ${String(kids.length)} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
