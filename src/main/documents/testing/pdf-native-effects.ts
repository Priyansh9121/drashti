// All drawing commands, text and PDF bytes in these fixtures are generated.
export const PDF_EDITABLE_WORDS = 'Placeholder editable words';

function stream(content: string, entries = ''): string {
  return '<< /Length ' + String(content.length) + entries + ' >>\nstream\n' + content + '\nendstream';
}

function placeholderPdf(content: string, resources = '', extraObjects: string[] = []): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >>' +
      resources +
      ' >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(content),
    ...extraObjects,
  ];
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
