import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import {
  generatedPdf,
  openGeneratedPdf,
  PDF_PAGES,
  requiredAt,
  savePdfCopy,
  usePdfTools,
} from './pdf-tools-fixtures';
import { inspectPdf, occurrences } from './pdf-export-oracle';
import { rawContent } from './deck-edit-fixtures';

for (const windowSize of [
  { width: 1024, height: 645 },
  { width: 1280, height: 720 },
]) {
  test(`explicitly links a legacy picture to PDF page two, keeping additions in one Undo at ${windowSize.width}`, async () => {
    const s = await openGeneratedPdf();
    let app = s.app;
    try {
      await app.close();
      const packagePath = join(s.folder, 'Placeholder legacy package.key');
      const packageObject = join(packagePath, 'Index', 'Placeholder document.iwa');
      const packageBytes = Buffer.from('Placeholder generated legacy package object');
      mkdirSync(join(packagePath, 'Index'), { recursive: true });
      writeFileSync(packageObject, packageBytes);
      // Only this test's stopped generated library is changed to model an older import.
      const db = new Database(join(s.userData, 'drashti.sqlite'));
      try {
        db.prepare(
          'UPDATE slides SET document_page = NULL WHERE group_id IN (SELECT id FROM slide_groups WHERE presentation_id = ?)',
        ).run(s.id);
        db.prepare(
          'UPDATE presentations SET width = 1920, height = 1080, source_path = ?, source_hash = NULL, content_rev = content_rev + 1 WHERE id = ?',
        ).run(packagePath, s.id);
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
      await sizeSlideEditor(app, ed, windowSize);
      await expect(editor.getByTestId('editor-source-issues')).toContainText(/which page of the original/iu);
      await editorGroup(ed, 'Insert');
      await editor.getByTestId('add-text').click();
      await editor.locator('[data-editing="true"] .ProseMirror').fill('Placeholder operator overlay');
      await ed.keyboard.press('Escape');
      await editorGroup(ed, 'Words');
      await editor.getByTestId('words-effects').click();
      await ed.getByTestId('field-shadow').selectOption('soft');
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
      const bounds = await linking.boundingBox();
      const viewport = await ed.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      if (!bounds) throw new Error('Missing reading-copy dialog bounds.');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 0.1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 0.1);
      await expect(linking.getByRole('button', { name: 'Link selected page', exact: true })).toBeInViewport();
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
      await expect(reopened.editor.getByTestId('editor-source-issues')).toContainText(
        /which page of the original/iu,
      );
      await app.evaluate(({ BrowserWindow }) => {
        const samples: { requested: number[]; actual: number[]; visible: boolean; focused: boolean }[] = [];
        const root = globalThis as unknown as { __readingCopySizes: typeof samples };
        root.__readingCopySizes = samples;
        const method: unknown = Reflect.get(BrowserWindow.prototype, 'setContentSize');
        if (typeof method !== 'function') throw new Error('Missing native content-size method.');
        const original = method as (
          this: InstanceType<typeof BrowserWindow>,
          width: number,
          height: number,
          animate?: boolean,
        ) => void;
        BrowserWindow.prototype.setContentSize = function (
          this: InstanceType<typeof BrowserWindow>,
          width: number,
          height: number,
          animate?: boolean,
        ) {
          original.call(this, width, height, animate);
          if (this.webContents.getURL().includes('pdf-export.html'))
            samples.push({
              requested: [width, height],
              actual: this.getContentSize(),
              visible: this.isVisible(),
              focused: this.isFocused(),
            });
        };
      });
      await usePdfTools(reopened.ed);
      const output = join(s.folder, `Placeholder legacy edited ${windowSize.width}.pdf`);
      await savePdfCopy(app, reopened.ed, output);
      const pdf = await inspectPdf(output);
      expect(pdf).toHaveLength(3);
      expect(pdf.map((page) => [page.width, page.height])).toEqual([
        [1920, 1080],
        [1920, 1080],
        [1920, 1080],
      ]);
      const native = requiredAt(pdf, 0, 'linked native output');
      expect(occurrences(native.words, 'Placeholder page A')).toBe(1);
      expect(occurrences(native.words, 'Placeholder operator overlay')).toBe(1);
      const sizes = await app.evaluate(
        () =>
          (
            globalThis as unknown as {
              __readingCopySizes: {
                requested: number[];
                actual: number[];
                visible: boolean;
                focused: boolean;
              }[];
            }
          ).__readingCopySizes,
      );
      expect(
        sizes.some((sample) => sample.requested[0] === 2560 && sample.requested[1] === 1440),
        'the actual full default-canvas shadow capture ran',
      ).toBe(true);
      for (const sample of sizes) {
        expect(sample.actual, 'the hidden viewport is not clamped to the physical display').toEqual(
          sample.requested,
        );
        expect(sample.visible).toBe(false);
        expect(sample.focused).toBe(false);
      }
      expect(readFileSync(packageObject)).toEqual(packageBytes);
      s.unchanged();
    } finally {
      await app.close();
      s.unchanged();
    }
  });
}
