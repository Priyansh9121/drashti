import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { generatedWordSubsetPdf } from '../fixtures/pdf-word-subset';
import { inspectPdf, occurrences } from './pdf-export-oracle';
import { openGeneratedPdf, savePdfCopy, usePdfTools } from './pdf-tools-fixtures';

// Generated placeholder words only. First run after alpha.21 is published.
test('PDF lines share one paragraph box and edited words wrap inside its width', async () => {
  const s = await openGeneratedPdf([
    {
      width: 480,
      height: 320,
      marker: 'Placeholder footer',
      paragraphLines: ['Placeholder paragraph first line', 'Placeholder paragraph next line', 'Last words'],
    },
  ]);
  try {
    const paragraph = s.editor
      .getByTestId('editor-slide')
      .locator('[data-element]')
      .filter({ hasText: 'Placeholder paragraph first line Placeholder paragraph next line Last words' });
    await expect(paragraph).toHaveCount(1);
    await paragraph.dblclick();
    const typing = s.editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    const revised =
      'Placeholder changed paragraph with enough extra words to wrap across several lines inside the original paragraph width.';
    await s.ed.keyboard.insertText(revised);
    await expect(typing).toHaveText(revised);
    const layout = await typing.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return {
        lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
        inside: rects.every((rect) => rect.right <= el.getBoundingClientRect().right + 1),
      };
    });
    expect(layout.lines).toBeGreaterThan(1);
    expect(layout.inside).toBe(true);
    s.unchanged();
  } finally {
    await s.app.close();
  }
});

test('a newly typed Gujarati letter uses bundled Noto on the page and stays searchable in the PDF copy', async () => {
  const s = await openGeneratedPdf([], generatedWordSubsetPdf);
  try {
    await expect(s.editor.getByTestId('editor-source-issues')).toContainText('Noto Sans Gujarati');
    const box = s.editor
      .getByTestId('editor-slide')
      .locator('[data-element]')
      .filter({ hasText: 'Placeholder source letters' });
    await box.dblclick();
    const typing = s.editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    const letters = 'કખગઘઙ ક્ષ';
    await s.ed.keyboard.insertText(letters);
    await expect(typing).toHaveText(letters);
    await typing.press('Escape');
    const rendered = s.editor
      .getByTestId('editor-slide')
      .locator('[data-element]')
      .filter({ hasText: letters });
    await expect(rendered).toHaveCount(1);
    const fonts = await rendered.evaluate((node) =>
      [node, ...node.querySelectorAll('span')].map((part) => getComputedStyle(part).fontFamily),
    );
    expect(fonts.some((family) => family.includes('Noto Sans Gujarati'))).toBe(true);
    // Independent shaped-glyph reference from the bundled font, not the source subset or PDF text map.
    const fontSize = await rendered.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    const reference = await s.ed.evaluate(
      ({ text, fontSize }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 60;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No reference canvas');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        ctx.font = `400 ${fontSize}px "Noto Sans Gujarati"`;
        ctx.fillText(text, 20, 30);
        return {
          pixels: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data],
          width: canvas.width,
          height: canvas.height,
        };
      },
      { text: letters, fontSize },
    );
    await usePdfTools(s.ed);
    const output = join(s.folder, 'Placeholder Gujarati copy.pdf');
    await savePdfCopy(s.app, s.ed, output);
    const pages = await inspectPdf(output);
    expect(pages).toHaveLength(1);
    const printed = pages[0];
    if (!printed) throw new Error('Missing printed page');
    expect(occurrences(printed.words, letters)).toBe(1);
    const expectedInk = inkShape(reference.pixels, reference.width, reference.height);
    const printedInk = inkShape(printed.pixels, printed.rasterWidth, printed.rasterHeight);
    expect(expectedInk.points.length).toBeGreaterThan(30);
    expect(printedInk.width).toBeGreaterThan(0);
    expect(Math.abs(printedInk.width - expectedInk.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(printedInk.height - expectedInk.height)).toBeLessThanOrEqual(2);
    // Allow one raster pixel for PDF.js/Chromium antialiasing; tofu and missing conjuncts fail both directions.
    expect(inkCoverage(expectedInk, printedInk)).toBeGreaterThan(0.95);
    expect(inkCoverage(printedInk, expectedInk)).toBeGreaterThan(0.95);
    s.unchanged();
  } finally {
    await s.app.close();
  }
});

test('Find next and replacement span PDF pages, and Replace all undoes once', async () => {
  const s = await openGeneratedPdf([
    { width: 480, height: 320, marker: 'Placeholder alpha page one' },
    { width: 480, height: 320, marker: 'Placeholder alpha page two' },
  ]);
  try {
    await s.ed.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await s.editor.getByTestId('find-text').fill('alpha');
    await expect(s.editor.getByTestId('find-count')).toHaveText('1 of 2');
    await s.editor.getByTestId('find-next').click();
    await expect(s.editor.getByTestId('find-count')).toHaveText('2 of 2');
    await expect(s.editor.getByTestId('find-where')).toContainText('Page 2');
    await s.editor.getByTestId('replace-text').fill('beta');
    await s.editor.getByTestId('replace-one').click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder beta page two');
    await s.editor.getByTestId('find-text').fill('Placeholder');
    await s.editor.getByTestId('replace-text').fill('Generated');
    await s.editor.getByTestId('replace-all').click();
    await expect(s.editor.getByTestId('find-count')).toHaveText('None found');
    await s.editor.getByTestId('find-close').click();
    await s.ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await s.ed.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await s.editor.getByTestId('find-text').fill('Placeholder');
    await expect(s.editor.getByTestId('find-count')).toHaveText('2 of 2');
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder beta page two');
    s.unchanged();
  } finally {
    await s.app.close();
  }
});

interface InkShape {
  width: number;
  height: number;
  points: [number, number][];
}
function inkShape(pixels: ArrayLike<number>, width: number, height: number): InkShape {
  const points: [number, number][] = [];
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if ((pixels[at] ?? 255) > 180 || (pixels[at + 1] ?? 255) > 180 || (pixels[at + 2] ?? 255) > 180)
        continue;
      points.push([x, y]);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return {
    width: Math.max(0, right - left + 1),
    height: Math.max(0, bottom - top + 1),
    points: points.map(([x, y]) => [x - left, y - top]),
  };
}
function inkCoverage(source: InkShape, target: InkShape): number {
  const ink = new Set(target.points.map(([x, y]) => `${x},${y}`));
  let found = 0;
  for (const [x, y] of source.points) {
    let near = false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (ink.has(`${x + dx},${y + dy}`)) near = true;
    if (near) found++;
  }
  return source.points.length ? found / source.points.length : 0;
}
