import { expect, test } from '@playwright/test';
import { openGeneratedPdf } from './pdf-tools-fixtures';

// Generated placeholder words only. First run after alpha.21 is published.
test('PDF lines share one paragraph box and edited words wrap inside its width', async () => {
  const s = await openGeneratedPdf([{ width: 480, height: 320, marker: 'Placeholder footer', paragraphLines: ['Placeholder paragraph first line', 'Placeholder paragraph next line', 'Last words'] }]);
  try {
    const paragraph = s.editor.getByTestId('editor-slide').locator('[data-element]').filter({ hasText: 'Placeholder paragraph first line Placeholder paragraph next line Last words' });
    await expect(paragraph).toHaveCount(1);
    await paragraph.dblclick();
    const typing = s.editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    const revised = 'Placeholder changed paragraph with enough extra words to wrap across several lines inside the original paragraph width.';
    await s.ed.keyboard.insertText(revised);
    await expect(typing).toHaveText(revised);
    const layout = await typing.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return { lines: new Set(rects.map((rect) => Math.round(rect.top))).size, inside: rects.every((rect) => rect.right <= el.getBoundingClientRect().right + 1) };
    });
    expect(layout.lines).toBeGreaterThan(1);
    expect(layout.inside).toBe(true);
    s.unchanged();
  } finally {
    await s.app.close();
  }
});
