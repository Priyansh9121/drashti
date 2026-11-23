import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { closeLibrary } from './helpers';
import { openNewPlaylist } from './hall-looks';
import { openGeneratedPdf, usePdfTools } from './pdf-tools-fixtures';

test('collected PDF parts cross pages, reorder and remove, make one presentation and Undo together', async () => {
  const { app, win, ed, unchanged } = await openGeneratedPdf();
  try {
    await closeLibrary(win);
    await openNewPlaylist(win, 'Placeholder collected parts');
    await usePdfTools(ed);
    await ed.getByRole('button', { name: 'Make a slide…', exact: true }).click();
    const dialog = ed.getByTestId('make-slide');
    await dialog.getByRole('button', { name: 'Add this part', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'PDF page', exact: true }).selectOption({ label: 'Page 2' });
    await dialog.getByTestId('make-slide-box').focus();
    await ed.keyboard.press('Enter');
    await dialog.getByRole('combobox', { name: 'PDF page', exact: true }).selectOption({ label: 'Page 3' });
    await dialog.getByRole('button', { name: 'Add this part', exact: true }).click();
    const parts = dialog.getByTestId('collected-part');
    await expect(parts).toHaveCount(3);
    await parts.nth(2).getByRole('button', { name: 'Remove part 3', exact: true }).click();
    await parts.nth(1).getByRole('button', { name: 'Drag part 2', exact: true }).dragTo(parts.nth(0));
    await expect(parts.nth(0)).toContainText('Page 2');
    await expect(parts.nth(1)).toContainText('Page 1');
    await expectNoSeriousA11yIssues(ed, 'Collected PDF parts');
    await dialog.getByRole('button', { name: 'Make 2 slides', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const name = 'Placeholder PDF tools, 2 parts';
    const rows = win.getByTestId('open-playlist').getByTestId('playlist-item');
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
    const made = await win.evaluate(async (name) => {
      const d = (globalThis as PageGlobals).drashti;
      const row = (await d.library.listPresentations()).find((p) => p.name === name);
      if (!row) throw new Error('No collected presentation');
      const result = await d.library.slidesForEdit(row.id);
      if (!result.ok) throw new Error(result.message);
      const slides = result.doc.groups.flatMap((g) => g.slides);
      const sizes = [];
      for (const slide of slides) {
        if (slide.elements.length !== 1) throw new Error('Expected one picture per slide');
        const picture = slide.elements[0];
        if (picture?.kind !== 'image') throw new Error('Expected a picture');
        const image = new Image();
        image.src = `drashti-media://media/${picture.mediaId}`;
        await image.decode();
        sizes.push([image.naturalWidth, image.naturalHeight]);
      }
      return { count: slides.length, sizes, canvas: [result.doc.width, result.doc.height] };
    }, name);
    expect(made).toEqual({
      count: 2,
      sizes: [
        [720, 1080],
        [1620, 1080],
      ],
      canvas: [1920, 1080],
    });
    unchanged();
    const notice = win.getByTestId('undo-removal');
    await expect(notice).toContainText(name);
    await notice.getByRole('button', { name: /Undo/u }).click();
    await expect(rows.filter({ hasText: name })).toHaveCount(0);
    await expect
      .poll(() =>
        win.evaluate(
          async (name) =>
            (await (globalThis as PageGlobals).drashti.library.listPresentations()).some(
              (p) => p.name === name,
            ),
          name,
        ),
      )
      .toBe(false);
  } finally {
    await app.close();
  }
});
