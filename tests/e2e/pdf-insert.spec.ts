import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawContent } from './deck-edit-fixtures';
import { importAndGetIds, openLibrary, slideEditorClosed, slideEditorWindow } from './helpers';
import {
  type GeneratedSourcePage,
  generatedPdf,
  openGeneratedPdf,
  PDF_LABELS,
  PDF_PAGES,
  savePdfCopy,
  usePdfTools,
} from './pdf-tools-fixtures';
import { inspectPdf, occurrences } from './pdf-export-oracle';

const inserted: [GeneratedSourcePage, GeneratedSourcePage] = [
  { width: 360, height: 240, marker: 'Placeholder inserted A', oldWords: 'Placeholder insertion words A' },
  { width: 240, height: 360, marker: 'Placeholder inserted B', oldWords: 'Placeholder insertion words B' },
];

test('inserting retained PDF pages keeps their order, paper, words and originals through one Undo and Save', async () => {
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  const sourceFile = join(s.folder, 'Placeholder insertion source.pdf');
  const sourceBytes = generatedPdf(inserted);
  writeFileSync(sourceFile, sourceBytes);
  const unchanged = () => {
    s.unchanged();
    expect(readFileSync(sourceFile)).toEqual(sourceBytes);
  };
  try {
    const [sourceId = ''] = await importAndGetIds(s.win, [sourceFile]);
    expect(sourceId).not.toBe('');
    const originalTarget = rawContent(s.userData, s.id);
    const originalSource = rawContent(s.userData, sourceId);
    const thumbs = s.editor.getByTestId('editor-slide-thumb');
    const oldIds = await thumbs.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-slide-id')),
    );
    await usePdfTools(s.ed);
    const action = s.ed.getByRole('button', { name: PDF_LABELS.insertPages, exact: true });
    await expect(action, 'PDF page insertion is an actual available editor action').toBeEnabled();
    await action.click();
    const dialog = s.ed.getByTestId('pdf-insert-dialog');
    await dialog.getByTestId('pdf-insert-source').filter({ hasText: 'Placeholder insertion source' }).click();
    await dialog.getByRole('button', { name: 'Insert pages', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(thumbs).toHaveCount(5);
    const ids = await thumbs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slide-id')));
    expect([ids[0], ids[3], ids[4]]).toEqual(oldIds);
    await expect(s.editor.getByTestId('editor-slide')).toContainText(inserted[0].oldWords);
    expect(rawContent(s.userData, s.id)).toEqual(originalTarget);
    expect(rawContent(s.userData, sourceId)).toEqual(originalSource);
    unchanged();
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(thumbs).toHaveCount(3);
    expect(
      await thumbs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slide-id'))),
    ).toEqual(oldIds);
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(thumbs).toHaveCount(5);
    await thumbs.nth(1).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText(inserted[0].oldWords);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const saved = rawContent(s.userData, s.id);
    expect(saved.slides).toHaveLength(5);
    const hash = createHash('sha256').update(sourceBytes).digest('hex');
    for (const [at, paper] of inserted.entries()) {
      const page = saved.slides[at + 1];
      if (!page) throw new Error('The inserted persisted page is missing.');
      expect(JSON.parse(String(page['document_page']))).toMatchObject({
        sha256: hash,
        ext: 'pdf',
        page: at,
        width: paper.width,
        height: paper.height,
      });
      expect(JSON.parse(String(page['page_size']))).toEqual({ width: paper.width, height: paper.height });
    }
    expect(rawContent(s.userData, sourceId)).toEqual(originalSource);
    await openLibrary(s.win);
    await s.win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder PDF tools' })
      .click();
    await s.win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(s.app);
    await expect(reopened.editor.getByTestId('editor-slide-thumb')).toHaveCount(5);
    await usePdfTools(reopened.ed);
    const output = join(s.folder, 'Placeholder inserted copy.pdf');
    await savePdfCopy(s.app, reopened.ed, output);
    const pages = await inspectPdf(output);
    const order = [PDF_PAGES[0], ...inserted, PDF_PAGES[1], PDF_PAGES[2]];
    expect(pages.map((page) => ({ width: page.width, height: page.height }))).toEqual(
      order.map((page) => ({ width: page.width, height: page.height })),
    );
    for (const [at, paper] of order.entries())
      expect(occurrences(pages[at]?.words ?? '', paper.marker)).toBe(1);
    unchanged();
  } finally {
    await s.app.close();
    unchanged();
  }
});

test('cancelling PDF page insertion changes no content or history', async () => {
  const s = await openGeneratedPdf();
  try {
    const before = rawContent(s.userData, s.id);
    await usePdfTools(s.ed);
    const action = s.ed.getByRole('button', { name: PDF_LABELS.insertPages, exact: true });
    await expect(action, 'PDF page insertion is available before opening its chooser').toBeEnabled();
    await action.click();
    await s.ed.getByTestId('pdf-insert-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(s.ed.getByTestId('pdf-insert-dialog')).toHaveCount(0);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect(rawContent(s.userData, s.id)).toEqual(before);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});
