import type { PDFPageProxy } from 'pdfjs-dist';
/** Paint-order words, including those outside CropBox; getTextContent intentionally filters to the page view. */
export async function pdfOperatorWords(page: PDFPageProxy): Promise<string> {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const ops = await page.getOperatorList();
  const textOps = new Set([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ]);
  const glyphs = (value: unknown): string =>
    Array.isArray(value)
      ? value.map(glyphs).join('')
      : typeof value === 'object' && value !== null && 'unicode' in value && typeof value.unicode === 'string'
        ? value.unicode
        : '';
  return ops.fnArray.map((fn, index) => (textOps.has(fn) ? glyphs(ops.argsArray[index]) : '')).join('');
}
