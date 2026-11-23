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
    // A small part of page 1 must be drawn afresh at the hall's size, rather than cropped from its thumbnail.
    const box = dialog.getByTestId('make-slide-box');
    const whole = await box.boundingBox();
    const corner = await box.locator('[data-edge="se"]').boundingBox();
    if (!whole || !corner) throw new Error('No crop frame');
    const from = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
    await ed.mouse.move(from.x, from.y);
    await ed.mouse.down();
    await ed.mouse.move(from.x - whole.width * 0.75, from.y - whole.height * 0.5, { steps: 10 });
    await ed.mouse.up();
    await expect(dialog.getByTestId('crop-readout')).toContainText('right 75%');
    await expect(dialog.getByTestId('crop-readout')).toContainText('bottom 50%');
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
        [810, 1080],
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

test('collected parts into the library keep the open playlist unchanged and support keyboard ordering', async () => {
  const { app, win, ed, unchanged } = await openGeneratedPdf();
  try {
    await closeLibrary(win);
    await openNewPlaylist(win, 'Placeholder unchanged parts playlist');
    await usePdfTools(ed);
    await ed.getByRole('button', { name: 'Make a slide…', exact: true }).click();
    const dialog = ed.getByTestId('make-slide');
    await dialog.getByRole('button', { name: 'Add this part', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'PDF page', exact: true }).selectOption({ label: 'Page 2' });
    await dialog.getByRole('button', { name: 'Add this part', exact: true }).click();
    const parts = dialog.getByTestId('collected-part');
    const earlier = parts.nth(1).getByRole('button', { name: 'Move part 2 earlier', exact: true });
    await earlier.focus();
    await ed.keyboard.press('Enter');
    await expect(parts.nth(0)).toContainText('Page 2');
    await parts.nth(0).getByRole('button', { name: 'Move part 1 later', exact: true }).click();
    await expect(parts.nth(0)).toContainText('Page 1');
    await dialog.getByRole('radio', { name: 'The library only', exact: true }).check();
    await dialog.getByRole('button', { name: 'Make 2 slides', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(0);
    const name = 'Placeholder PDF tools, 2 parts';
    await expect(ed.getByTestId('editor-note')).toContainText(`Made “${name}” in the library.`);
    const notice = win.getByTestId('undo-removal');
    await expect(notice).toContainText(name);
    await notice.getByRole('button', { name: /Undo/u }).click();
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
    unchanged();
  } finally {
    await app.close();
  }
});
