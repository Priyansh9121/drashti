import { expect, test } from '@playwright/test';
import { sizeSlideEditor } from './helpers';
import { openGeneratedPdf, PDF_PAGES } from './pdf-tools-fixtures';

for (const size of [
  { width: 1280, height: 720 },
  { width: 1024, height: 645 },
]) {
  test(`the PDF page strip fits independent paper at window width ${size.width}`, async () => {
    const s = await openGeneratedPdf();
    try {
      await sizeSlideEditor(s.app, s.ed, size);
      for (const [index, paper] of PDF_PAGES.entries()) {
        const thumb = s.editor.getByTestId('editor-slide-thumb').nth(index);
        const viewport = await thumb.locator(':scope > span').first().boundingBox();
        const content = await thumb.locator('[data-slide]').boundingBox();
        if (!viewport || !content) throw new Error('Missing generated PDF thumbnail.');
        const scale = Math.min(viewport.width / paper.width, viewport.height / paper.height);
        const expected = {
          width: paper.width * scale,
          height: paper.height * scale,
          x: viewport.x + (viewport.width - paper.width * scale) / 2,
          y: viewport.y + (viewport.height - paper.height * scale) / 2,
        };
        for (const key of ['width', 'height', 'x', 'y'] as const)
          expect(content[key], `paper ${index} thumbnail ${key}`).toBeCloseTo(expected[key], 1);
      }
      s.unchanged();
    } finally {
      await s.app.close();
      s.unchanged();
    }
  });
}
