import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawContent } from './deck-edit-fixtures';
import { slideEditorClosed, slideEditorWindow } from './helpers';
import { generatedPdf, openGeneratedPdf, PDF_LABELS, savePdfCopy, usePdfTools } from './pdf-tools-fixtures';
import { inspectPdf, occurrences } from './pdf-export-oracle';

test('a PDF chosen from a file inserts native pages without a separate library presentation and protects its original on export', async () => {
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  const source = join(s.folder, 'Placeholder direct source.pdf');
  const papers = [
    { width: 360, height: 240, marker: 'Placeholder direct A', oldWords: 'Placeholder direct words A' },
    { width: 240, height: 360, marker: 'Placeholder direct B', oldWords: 'Placeholder direct words B' },
  ];
  const bytes = generatedPdf(papers);
  writeFileSync(source, bytes);
  try {
    await s.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, source);
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: PDF_LABELS.insertPages, exact: true }).click();
    const picker = s.ed.getByTestId('pdf-insert-dialog');
    const choose = picker.getByRole('button', { name: 'Choose a PDF file…', exact: true });
    await expect(
      choose,
      'page insertion can choose an actual file without importing a separate presentation',
    ).toBeVisible();
    await choose.click();
    await expect(picker).toHaveCount(0);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(5);
    await expect(s.editor.getByTestId('editor-slide')).toContainText(
      papers[0]?.oldWords ?? 'Missing generated paper',
    );
    await expect(s.win.getByTestId('presentation-list')).not.toContainText('Placeholder direct source');
    expect(rawContent(s.userData, s.id).slides).toHaveLength(3);
    expect(readFileSync(source)).toEqual(bytes);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const rows = rawContent(s.userData, s.id);
    expect(rows.slides).toHaveLength(5);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(JSON.parse(String(rows.slides[1]?.['document_page']))).toMatchObject({
      sha256: hash,
      ext: 'pdf',
      page: 0,
    });
    await s.win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(s.app);
    await usePdfTools(reopened.ed);
    const output = join(s.folder, 'Placeholder direct inserted copy.pdf');
    await savePdfCopy(s.app, reopened.ed, output);
    const exported = await inspectPdf(output);
    expect(exported).toHaveLength(5);
    expect(exported.slice(1, 3).map((page) => ({ width: page.width, height: page.height }))).toEqual(
      papers.map((page) => ({ width: page.width, height: page.height })),
    );
    for (const [at, page] of papers.entries())
      expect(occurrences(exported[at + 1]?.words ?? '', page.marker)).toBe(1);
    await s.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, source);
    await reopened.ed.getByRole('button', { name: PDF_LABELS.export, exact: true }).click();
    await expect(reopened.ed.getByTestId('editor-note')).toContainText('could not be saved safely');
    expect(readFileSync(source)).toEqual(bytes);
    s.unchanged();
  } finally {
    await s.app.close();
    expect(readFileSync(source)).toEqual(bytes);
    s.unchanged();
  }
});
