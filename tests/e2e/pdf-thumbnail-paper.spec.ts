import { expect, test } from '@playwright/test';
import { sizeSlideEditor } from './helpers';
import { openGeneratedPdf, PDF_PAGES } from './pdf-tools-fixtures';

const boxFields = ['width', 'height', 'x', 'y'] as const;

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
        const readBoxes = async () => {
          const [viewport, content] = await Promise.all([
            thumb.locator(':scope > span').first().boundingBox(),
            thumb.locator('[data-slide]').boundingBox(),
          ]);
          return viewport && content ? { viewport, content } : null;
        };
        const sample: { last: Awaited<ReturnType<typeof readBoxes>> } = { last: null };
        await expect
          .poll(
            async () => {
              const previous = sample.last;
              const next = await readBoxes();
              sample.last = next;
              return (
                previous !== null &&
                next !== null &&
                boxFields.every(
                  (key) =>
                    previous.viewport[key] === next.viewport[key] &&
                    previous.content[key] === next.content[key],
                )
              );
            },
            { message: 'The PDF thumbnail and its viewport have settled.' },
          )
          .toBe(true);
        if (sample.last === null) throw new Error('Missing generated PDF thumbnail.');
        const { viewport, content } = sample.last;
        const scale = Math.min(viewport.width / paper.width, viewport.height / paper.height);
        const expected = {
          width: paper.width * scale,
          height: paper.height * scale,
          x: viewport.x + (viewport.width - paper.width * scale) / 2,
          y: viewport.y + (viewport.height - paper.height * scale) / 2,
        };
        for (const key of boxFields)
          expect(content[key], `paper ${index} thumbnail ${key}`).toBeCloseTo(expected[key], 1);
      }
      s.unchanged();
    } finally {
      await s.app.close();
      s.unchanged();
    }
  });
}
