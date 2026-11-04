/* Setup validation only: these passes are never counted as product feature RED. */
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatedPdf, PDF_PAGES, requiredAt } from './pdf-tools-fixtures';
import { inspectPdf, occurrences, pdfRectInRaster, pixelsIn, whiteInk } from './pdf-export-oracle';

test('generated PDF parser, raster and rotation oracle preconditions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pdf-oracle-'));
  const original = join(dir, 'Placeholder source.pdf');
  const blank = join(dir, 'Placeholder no old words.pdf');
  writeFileSync(original, generatedPdf(PDF_PAGES));
  writeFileSync(blank, generatedPdf(PDF_PAGES.map((page) => ({ ...page, oldWords: undefined }))));
  const source = await inspectPdf(original),
    background = await inspectPdf(blank);
  expect(source.map((page) => [page.width, page.height])).toEqual([
    [480, 320],
    [320, 480],
    [481.25, 319.5],
  ]);
  for (let i = 0; i < PDF_PAGES.length; i++) {
    const fixture = requiredAt(PDF_PAGES, i, 'source page metadata');
    const sourcePage = requiredAt(source, i, 'source raster page');
    const backgroundPage = requiredAt(background, i, 'background raster page');
    expect(occurrences(sourcePage.words, fixture.oldWords)).toBe(1);
    expect(occurrences(sourcePage.words, fixture.marker)).toBe(1);
    const roi = pdfRectInRaster(sourcePage, [145, fixture.height / 2 + 2, 278, fixture.height / 2 + 18]);
    expect(whiteInk(pixelsIn(sourcePage, roi))).toBeGreaterThan(20);
    expect(whiteInk(pixelsIn(backgroundPage, roi))).toBe(0);
  }
  const turned = join(dir, 'Placeholder turned clean.pdf');
  writeFileSync(turned, generatedPdf([{ ...PDF_PAGES[1], oldWords: undefined, rotation: 90 }]));
  expect((await inspectPdf(turned)).map((page) => [page.width, page.height])).toEqual([[480, 320]]);
});
