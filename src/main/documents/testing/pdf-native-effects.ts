// All drawing commands, text and PDF bytes in these fixtures are generated.
export const PDF_EDITABLE_WORDS = 'Placeholder editable words';

function stream(content: string, entries = ''): string {
  return '<< /Length ' + String(content.length) + entries + ' >>\nstream\n' + content + '\nendstream';
}

function placeholderPdf(content: string, resources = '', extraObjects: string[] = []): Buffer {
  return pdfFile([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >>' +
      resources +
      ' >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(content),
    ...extraObjects,
  ]);
}

function pdfFile(objects: readonly string[]): Buffer {
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

const text = 'BT /F1 12 Tf 1 0 0 1 24 31 Tm (' + PDF_EDITABLE_WORDS + ') Tj ET';

export function clippedWordsPdf(): Buffer {
  return placeholderPdf(
    'q 10 12 25 30 re W n 1 0 0 rg 0 0 140 80 re f Q\n' +
      'q 0 0 200 100 re W n ' +
      text +
      ' Q\nq 70 24 30 20 re W* n 0 1 0 rg 0 0 140 80 re f Q',
  );
}

export function maskedWordsPdf(): Buffer {
  return placeholderPdf(
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
}

export function clippedGlyphsPdf(): Buffer {
  return placeholderPdf('q 24 16 18 26 re W n ' + text + ' Q');
}

export const PDF_GROUP_WORDS = 'Placeholder group words';

export function formWordsPdf(grouped: boolean): Buffer {
  const group = grouped ? ' /Group << /S /Transparency /CS /DeviceRGB /I true /K true >>' : '';
  return placeholderPdf('q /Form Do Q\n' + text, ' /XObject << /Form 6 0 R >>', [
    stream(
      'BT /F1 12 Tf 1 0 0 1 24 120 Tm (' + PDF_GROUP_WORDS + ') Tj ET',
      ' /Type /XObject /Subtype /Form /BBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >>' + group,
    ),
  ]);
}

export function clippedDeckPdf(pageCount: number, complexPage?: number): Buffer {
  const rgb = Array.from({ length: 8 * 4 * 3 }, (_, i) =>
    ((i * 53) % 256).toString(16).padStart(2, '0'),
  ).join('');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(
      rgb + '>',
      ' /Type /XObject /Subtype /Image /Width 8 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8' +
        ' /Filter /ASCIIHexDecode',
    ),
  ];
  const pages: string[] = [];
  for (let index = 0; index < pageCount; index++) {
    const rectangles = Array.from({ length: index === complexPage ? 180 : 3 }, (_, i) => {
      const x = 10 + (i % 20) * 18;
      const y = 15 + Math.floor(i / 20) * 22;
      return String(x) + ' ' + String(y) + ' 9 11 re f';
    });
    objects.push(
      stream(
        [
          'q 0 0 480 270 re W n',
          'q 160 0 0 80 280 160 cm /Picture Do Q',
          '0.4 0.6 0.8 rg',
          ...rectangles,
          '0 0 0 rg',
          text,
          'Q',
        ].join('\n'),
      ),
    );
    const contents = objects.length;
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 270] /Contents ' +
        String(contents) +
        ' 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Picture 4 0 R >> >> >>',
    );
    pages.push(String(objects.length) + ' 0 R');
  }
  objects[1] = '<< /Type /Pages /Kids [' + pages.join(' ') + '] /Count ' + String(pages.length) + ' >>';
  return pdfFile(objects);
}

export function strokedEffectPdf(paint: string): Buffer {
  return placeholderPdf(`q 0 0 240 160 re W n 12 w 0 0 1 RG 1 1 0 rg ${paint} Q`);
}

export function paintedClipEffectPdf(paint: string): Buffer {
  return placeholderPdf(`q 10 w 0 1 0 RG 0 0 1 rg 48 40 145 90 re W ${paint} 1 0 0 rg 60 60 10 10 re f Q`);
}

export function rotatedGroupedEffectPdf(): Buffer {
  return placeholderPdf(
    'q 0 0 240 160 re W n /Half gs /Form Do Q',
    ' /XObject << /Form 6 0 R >> /ExtGState << /Half << /Type /ExtGState /ca 0.5 /CA 0.5 >> >>',
    [
      stream(
        '0 1 -1 0 175 32 cm 0 0 1 rg 0 0 95 54 re f 1 0 0 rg 55 15 53 42 re f h f',
        ' /Type /XObject /Subtype /Form /BBox [0 0 240 160] /Group << /S /Transparency /I true >>',
      ),
    ],
  );
}

export function unusedBlendModePdf(): Buffer {
  return placeholderPdf(
    '1 0 0 rg 20 28 100 64 re f 0 0 1 rg 90 60 110 72 re f',
    ' /ExtGState << /Unused << /Type /ExtGState /BM /Multiply >> >>',
  );
}

export function longTextEffectPdf(count: number): Buffer {
  return placeholderPdf(`q 0 0 240 160 re W n BT /F1 2 Tf 3 24 Td ${'(x) Tj\n'.repeat(count)}ET Q`);
}
