/*
 * Book OCR's test pages (alpha.21): placeholder Gujarati words (days, colours, fruits, numbers, things in a house,
 * directions: never kirtan or scripture text), drawn by the tests with Noto Sans Gujarati, and what a reading of them
 * must find. Also a "scanned" PDF made of page pictures, as a scanner makes one.
 */

/** Page 1's placeholder lines; a blank line between groups, as a book's verses. */
export const PAGE_ONE = [
  'નમૂના પાનું: અક્ષરો વાંચવાની કસોટી',
  '',
  'સોમવાર મંગળવાર બુધવાર ગુરુવાર',
  'શુક્રવાર શનિવાર રવિવાર',
  '',
  'લાલ પીળો લીલો વાદળી સફેદ કાળો',
  'કેરી કેળું દ્રાક્ષ સફરજન નારંગી',
  '',
  'એક બે ત્રણ ચાર પાંચ છ સાત',
  'આઠ નવ દસ અગિયાર બાર',
] as const;

/** Page 2's placeholder lines, none of page 1's words. */
export const PAGE_TWO = [
  'ઘર બારી દરવાજો ખુરશી ટેબલ',
  'સવારે નિશાળ, બપોરે રમત, સાંજે વાંચન',
  '',
  'પુસ્તક કાગળ પેન્સિલ રબર',
  'ઉત્તર દક્ષિણ પૂર્વ પશ્ચિમ',
  'ગામ શહેર નદી પર્વત ખેતર',
] as const;

/**
 * The bounds a reading of a test page must reach, from the engine trial (N/reports/ocr-trial.md, 22 Nov 2026):
 * Tesseract with this model found 96.1-99.5% of the Gujarati letters of three real booklet pages at 300 dpi and
 * 96.6-99.3% of their scan-like copies (150 dpi, turned 1.5 degrees); 89.8-95.3% of what it wrote was right (the
 * pages' ornaments read as marks). A clean test page in one plain font reads at least as well: 99.6-100% both ways
 * (this build, 23 Nov 2026, at 120 and 200 pixels an inch and turned 1.5 degrees). So 95% of the letters found (under
 * the trial's lowest, 96.1%) and 90% of what it wrote right: a few letters may differ with each system's font
 * drawing, but a broken reading (another model, words lost, a page missed or read twice) falls well below.
 */
export const LETTERS_FOUND_AT_LEAST = 0.95;
export const LETTERS_RIGHT_AT_LEAST = 0.9;

/** Gujarati letters (U+0A80-U+0AFF) and how many times each comes. */
function lettersOf(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of text.normalize('NFC'))
    if (ch >= '઀' && ch <= '૿') counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

/**
 * How well `read` has the Gujarati letters of `expected`, in any order (the trial's order-blind measure): `found`, the
 * share of the expected letters it has; `right`, the share of its letters that were expected.
 */
export function letterScore(expected: string, read: string): { found: number; right: number } {
  const want = lettersOf(expected);
  const got = lettersOf(read);
  let both = 0;
  let wanted = 0;
  let written = 0;
  for (const [ch, n] of want) {
    wanted += n;
    both += Math.min(n, got.get(ch) ?? 0);
  }
  for (const n of got.values()) written += n;
  return { found: wanted === 0 ? 0 : both / wanted, right: written === 0 ? 0 : both / written };
}

/**
 * A PDF whose pages are pictures only, as a scanner makes one: each page an A4 sheet filled by one JPEG (as the
 * canvas makes it). No words in it as text: only reading its pictures finds them.
 */
export function scannedPdf(pages: readonly { jpeg: Uint8Array; width: number; height: number }[]): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string): number => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const kids: number[] = [];
  for (const page of pages) {
    const image = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${String(page.width)} /Height ${String(page.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(page.jpeg.length)} >>\nstream\n`,
          'latin1',
        ),
        Buffer.from(page.jpeg),
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
    const paint = 'q 595 0 0 842 0 0 cm /Scan Do Q';
    const contents = add(`<< /Length ${String(paint.length)} >>\nstream\n${paint}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${String(contents)} 0 R /Resources << /XObject << /Scan ${String(image)} 0 R >> >> >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(' ')}] /Count ${String(kids.length)} >>`,
    'latin1',
  );
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0]?.length ?? 0;
  objects.forEach((body, i) => {
    offsets.push(at);
    const chunk = Buffer.concat([
      Buffer.from(`${String(i + 1)} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [
    'xref',
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${String(objects.length + 1)} /Root 1 0 R >>`,
    'startxref',
    String(at),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
