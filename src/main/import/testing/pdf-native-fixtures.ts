/* Generated placeholder PDFs only. Follows testing/make-pdf.ts's classic-xref
 * builder; adds controlled paint commands and ExtGState resources without any
 * PDF writer package, file IO, real content, or operator-list mocks. */
export type NativePdfCase = 'rectangle' | 'cubic' | 'multiply-bands' | 'fill-text' | 'fill-stroke-text';
export const OUTLINED_PLACEHOLDER = 'Placeholder outlined words';

export function nativePaintPdf(which: NativePdfCase): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [5 0 R] /Count 1 >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let content: string;
  let extraResources = '';
  switch (which) {
    case 'rectangle':
      content = 'q\n0.2 0.4 0.8 rg\n40 30 80 60 re f\nQ';
      break;
    case 'cubic':
      // Control bounds y30..90; actual curve ink reaches only y75. Native
      // normalized coordinates need control bounds, not PDF.js minMax alone.
      content = 'q\n0.6 0.2 0.4 rg\n20 30 m\n20 90 100 90 100 30 c\nh\nf\nQ';
      break;
    case 'multiply-bands':
      // A blue band multiplies the already-painted red band: the overlap is
      // black. Separating each paint into an ordinary source-over PNG loses it.
      // No transparency-group/page Group dictionary hides this behind a mask.
      extraResources = ' /ExtGState << /Mul << /Type /ExtGState /BM /Multiply /ca 1 /CA 1 >> >>';
      content =
        'q\n1 0 0 rg\n30 30 100 60 re f\nQ\nq\n/Mul gs\n0 0 1 rg\n80 30 100 60 re f\nQ\nq\n0 1 0 rg\n10 120 20 10 re f\nQ';
      break;
    case 'fill-text':
    case 'fill-stroke-text':
      content =
        'q\n0.2 0.4 0.8 rg\n1 0 0 RG\n2 w\nBT\n/F1 18 Tf\n' +
        (which === 'fill-stroke-text' ? '2' : '0') +
        ' Tr\n1 0 0 1 24 90 Tm\n(' +
        OUTLINED_PLACEHOLDER +
        ') Tj\nET\nQ';
      break;
  }
  add(
    '<< /Length ' + String(Buffer.byteLength(content, 'latin1')) + ' >>\nstream\n' + content + '\nendstream',
  );
  add(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 4 0 R /Resources << /Font << /F1 3 0 R >>' +
      extraResources +
      ' >> >>',
  );
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += String(index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + String(objects.length + 1) + '\n0000000000 65535 f \n';
  for (const offset of offsets) out += String(offset).padStart(10, '0') + ' 00000 n \n';
  out +=
    'trailer\n<< /Size ' +
    String(objects.length + 1) +
    ' /Root 1 0 R >>\nstartxref\n' +
    String(xref) +
    '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
