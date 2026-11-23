import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sfntFromWoff } from '../../src/main/import/testing/embedded-font';

/** Generated page with the bundled Noto Latin subset embedded: no Gujarati glyph exists in this font. */
export function generatedWordSubsetPdf(): Buffer {
  const require = createRequire(import.meta.url);
  const font = sfntFromWoff(
    readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')),
  );
  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };
  const stream = (dictionary: string, data: Buffer) =>
    add(
      Buffer.concat([
        Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
        data,
        Buffer.from('\nendstream'),
      ]),
    );
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 320] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  );
  add(
    `<< /Type /Font /Subtype /TrueType /BaseFont /AAAAAA+NotoSans /FirstChar 32 /LastChar 126 /Widths [${Array.from({ length: 95 }, () => '600').join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor 5 0 R >>`,
  );
  add(
    '<< /Type /FontDescriptor /FontName /AAAAAA+NotoSans /Flags 32 /FontBBox [-1000 -1000 2000 2000] /ItalicAngle 0 /Ascent 1069 /Descent -293 /CapHeight 714 /StemV 80 /FontFile2 6 0 R >>',
  );
  stream(`/Length1 ${font.length}`, font);
  stream('', Buffer.from('BT /F1 18 Tf 24 220 Td (Placeholder source letters) Tj ET'));
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
