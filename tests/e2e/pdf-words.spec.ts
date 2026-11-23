import { expect, test } from '@playwright/test';
import { join } from 'node:path';
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
  const s = await openGeneratedPdf([{ width: 480, height: 320, marker: 'Placeholder source letters' }]);
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
    const fonts = await rendered
      .locator('span')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
    expect(fonts.some((family) => family.includes('Noto Sans Gujarati'))).toBe(true);
    await usePdfTools(s.ed);
    const output = join(s.folder, 'Placeholder Gujarati copy.pdf');
    await savePdfCopy(s.app, s.ed, output);
    const pages = await inspectPdf(output);
    expect(pages).toHaveLength(1);
    expect(occurrences(pages[0]?.words ?? '', letters)).toBe(1);
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
