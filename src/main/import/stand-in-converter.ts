import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PptxSlide } from './pictures';

/*
 * Tests only (Session 26a): a stand-in for Keynote and PowerPoint, so a test
 * on a computer with neither (CI's) can import a PowerPoint file as a deck of
 * picture slides, as the real apps make one. Turned on by
 * DRASHTI_TEST_DECK_CONVERTER=1, which a packaged Drashti ignores.
 *
 * It saves the file "as PDF" the way PowerPoint would: one page per slide
 * shown (hidden slides left out), 16:9, each page one colour with a line of
 * placeholder words naming the deck by a hash of its bytes, so two decks
 * never draw the same pictures.
 */

/** A PDF of plain pages, written by hand (as the tests' own PDF maker does). */
function plainPdf(pages: { color: [number, number, number]; text: string }[]): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const kids: number[] = [];
  for (const page of pages) {
    const [r, g, b] = page.color.map((c) => (c / 255).toFixed(3));
    const words = page.text.replace(/[\\()]/gu, '').replace(/[^\x20-\x7e]/gu, '?');
    const content = [
      `${r} ${g} ${b} rg`,
      '0 0 960 540 re f',
      '1 1 1 rg',
      'BT',
      '/F1 40 Tf',
      '60 270 Td',
      `(${words}) Tj`,
      'ET',
    ].join('\n');
    objects.push(
      `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
    );
    const stream = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${String(stream)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    kids.push(objects.length);
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

/** Save a PowerPoint file "as PDF" in `work`, as the stand-in for Keynote and PowerPoint. */
export async function standInPdf(
  deck: string,
  slides: readonly PptxSlide[] | null,
  work: string,
): Promise<string> {
  const hash = createHash('sha256')
    .update(await readFile(deck))
    .digest('hex');
  const shown = Math.max(1, (slides ?? [{ hidden: false }]).filter((s) => !s.hidden).length);
  const seed = parseInt(hash.slice(0, 6), 16);
  const pages = Array.from({ length: shown }, (_, i) => {
    const hue = (seed + i * 47) % 360;
    // A dark colour from the hue, so the white words read on it.
    const c = (n: number) => Math.round(60 + 60 * Math.cos(((hue + n) * Math.PI) / 180));
    return {
      color: [c(0), c(120), c(240)] as [number, number, number],
      text: `Placeholder ${hash.slice(0, 8)} page ${String(i + 1)}`,
    };
  });
  const pdf = join(work, 'stand-in.pdf');
  await writeFile(pdf, plainPdf(pages));
  return pdf;
}
