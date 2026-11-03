import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  editorGroup,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { generatedPdf, openGeneratedPdf, PDF_PAGES, requiredAt } from './pdf-tools-fixtures';
import { rawContent } from './deck-edit-fixtures';

test('explicitly links a legacy picture to PDF page two, keeping unsaved operator additions in one Undo', async () => {
  const s = await openGeneratedPdf();
  let app = s.app;
  try {
    await app.close();
    // Only this test's stopped generated library is changed to model an older import.
    const db = new Database(join(s.userData, 'drashti.sqlite'));
    try {
      db.prepare(
        'UPDATE slides SET document_page = NULL WHERE group_id IN (SELECT id FROM slide_groups WHERE presentation_id = ?)',
      ).run(s.id);
      db.prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?').run(s.id);
    } finally {
      db.close();
    }
    const old = rawContent(s.userData, s.id);
    const firstId = requiredAt(old.slides, 0, 'legacy first').id;
    const oldPicture = old.elements.find(
      (element) => element.slide_id === firstId && element['kind'] === 'image',
    );
    if (!oldPicture) throw new Error('Missing generated legacy source picture.');
    app = (await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' }, s.userData)).app;
    const win = await operatorPage(app);
    await operatorReady(win);
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder PDF tools' })
      .click();
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    await expect(editor.getByTestId('editor-source-issues')).toContainText(/ambiguous/iu);
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-text').click();
    await editor.locator('[data-editing="true"] .ProseMirror').fill('Placeholder operator overlay');
    await ed.keyboard.press('Escape');
    const overlay = editor
      .getByTestId('editor-slide')
      .locator('[data-element]')
      .filter({ hasText: 'Placeholder operator overlay' });
    const overlayId = await overlay.getAttribute('data-element');
    expect(overlayId).not.toBeNull();
    const beforeOverlay = await overlay.getAttribute('style');
    const readingCopy = join(s.folder, 'Placeholder explicit PDF reading copy.pdf');
    writeFileSync(
      readingCopy,
      generatedPdf([
        requiredAt(PDF_PAGES, 2, 'reading page one'),
        requiredAt(PDF_PAGES, 0, 'reading page two'),
      ]),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, readingCopy);
    await editor.getByRole('button', { name: 'Link source page…', exact: true }).click();
    const linking = ed.getByRole('dialog', { name: 'Link a PDF reading copy', exact: true });
    await linking.getByRole('button', { name: 'Choose a PDF reading copy…', exact: true }).click();
    await linking.getByRole('radio', { name: 'Page 2', exact: true }).check();
    await linking.getByRole('button', { name: 'Link selected page', exact: true }).click();
    await expect(linking).toHaveCount(0);
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder page A');
    await expect(
      editor.getByTestId('editor-slide').locator(`[data-element="${String(oldPicture['id'])}"]`),
    ).toHaveCount(0);
    await expect(overlay).toHaveAttribute('data-element', String(overlayId));
    await expect(overlay).toHaveAttribute('style', String(beforeOverlay));
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      editor.getByTestId('editor-slide').locator(`[data-element="${String(oldPicture['id'])}"]`),
    ).toHaveCount(1);
    await expect(overlay).toHaveAttribute('style', String(beforeOverlay));
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder page A');
    // Nothing persists until the normal Save.
    expect(rawContent(s.userData, s.id).slides).toEqual(old.slides);
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const kept = rawContent(s.userData, s.id);
    expect(JSON.parse(String(kept.slides[0]?.['document_page']))).toMatchObject({
      ext: 'pdf',
      page: 1,
      edited: true,
    });
    expect(kept.slides.slice(1)).toEqual(old.slides.slice(1));
    expect(kept.elements.filter((element) => element.slide_id !== firstId)).toEqual(
      old.elements.filter((element) => element.slide_id !== firstId),
    );
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await expect(reopened.editor.getByTestId('editor-slide')).toContainText('Placeholder page A');
    await expect(reopened.editor.getByTestId('editor-slide')).toContainText('Placeholder operator overlay');
    await expect(reopened.editor.getByTestId('editor-source-issues')).toContainText(/ambiguous/iu);
    s.unchanged();
  } finally {
    await app.close();
    s.unchanged();
  }
});
