import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { openGeneratedPdf, savePdfCopy, usePdfTools } from './pdf-tools-fixtures';
import { inspectPdf } from './pdf-export-oracle';

test('extracts chosen pages to a PDF copy in reading order without changing the original', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Extract pages…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-pages-dialog');
    await dialog.getByLabel('Pages').fill('1, 3');
    await dialog.getByLabel('New PDF file').check();
    const output = join(s.folder, 'Placeholder extracted.pdf');
    // The existing save helper supplies the native save dialog's destination.
    await savePdfCopy(s.app, s.ed, output, async () => {
      await dialog.getByRole('button', { name: 'Extract pages', exact: true }).click();
    });
    expect(await inspectPdf(output)).toHaveLength(2);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});

test('replaces one page and undoes it, then splits before the chosen page with Undo', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Replace page…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-insert-dialog');
    await expect(dialog.getByLabel('Page number')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
    await s.ed.getByRole('button', { name: 'Split…', exact: true }).click();
    await s.ed.getByTestId('pdf-pages-dialog').getByRole('button', { name: 'Split presentation', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(1);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    s.unchanged();
  } finally { await s.app.close(); s.unchanged(); }
});

test('keeps a header footer watermark and page numbers on one master through PDF export and Undo', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Hand-out…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-handout-dialog');
    await dialog.getByLabel('Header').fill('Placeholder header');
    await dialog.getByLabel('Footer').fill('Placeholder footer');
    await dialog.getByLabel('Watermark').fill('Placeholder draft');
    await dialog.getByLabel('Page numbers').check();
    await dialog.getByRole('button', { name: 'Keep hand-out', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder header');
    const output = join(s.folder, 'Placeholder handout.pdf');
    await savePdfCopy(s.app, s.ed, output);
    const pages = await inspectPdf(output);
    expect(pages).toHaveLength(3);
    for (const [i, page] of pages.entries()) {
      expect(page.words).toContain('Placeholder header');
      expect(page.words).toContain('Placeholder footer');
      expect(page.words).toContain('Placeholder draft');
      expect(page.words).toContain(String(i + 1));
    }
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).not.toContainText('Placeholder header');
    s.unchanged();
  } finally { await s.app.close(); s.unchanged(); }
});
