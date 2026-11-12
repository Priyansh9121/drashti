/* Generated source PDFs only. Existing words become native; originals and untouched playback stay exact. */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { rawContent } from './deck-edit-fixtures';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  slideEditorClosed,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';

const ORIGINAL = 'Placeholder original MMMMMMMMMMMM';
const REVISED = 'Placeholder revised';

async function savedWords(win: Page, id: string): Promise<string[]> {
  return win.evaluate(async (id) => {
    const opened = await (globalThis as PageGlobals).drashti.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    return (opened.doc.groups[0]?.slides[0]?.elements ?? [])
      .filter((element) => element.kind === 'text')
      .map((element) => element.text);
  }, id);
}

for (const operation of ['replace', 'delete'] as const) {
  test(`a PDF page's existing words can ${operation === 'replace' ? 'be changed' : 'be deleted'}, saved and reopened without changing the source`, async () => {
    test.setTimeout(150_000);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-edit-pdf-'));
    const source = join(dir, 'Placeholder editable page.pdf');
    const originalBytes = makeTestPdf([
      { width: 960, height: 540, color: [0, 0, 0], text: ORIGINAL },
      { width: 960, height: 540, color: [18, 52, 86], text: 'Placeholder untouched page' },
    ]);
    writeFileSync(source, originalBytes);
    const sourceUnchanged = () =>
      expect(readFileSync(source).equals(originalBytes), 'the exact original PDF bytes').toBe(true);
    const { app, userData } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [source]);
      expect(id, 'generated searchable PDF imported successfully').not.toBe('');
      sourceUnchanged();
      const before = rawContent(userData, id);
      const untouchedId = before.slides[1]?.id;
      expect(untouchedId, 'the generated second page is stored').toBeTruthy();
      const untouchedRows = (rows: ReturnType<typeof rawContent>) => ({
        slide: rows.slides.find((slide) => slide.id === untouchedId),
        elements: rows.elements.filter((element) => element.slide_id === untouchedId),
        cues: rows.cues.filter((cue) => cue.slide_id === untouchedId),
      });
      const untouchedBefore = untouchedRows(before);
      await openLibrary(win);
      await win
        .getByTestId('presentation-list')
        .getByTestId('presentation-row')
        .filter({ hasText: 'Placeholder editable page' })
        .click();
      await win.getByTestId('edit-slides').click();
      const { ed, editor } = await slideEditorWindow(app);

      // Behavior RED on today's picture-only import, not a proposed API failure.
      // Inspect the editor first: extraction may be an unsaved in-memory copy until Save.
      const originalBox = editor
        .getByTestId('editor-slide')
        .locator('[data-element]')
        .filter({ hasText: ORIGINAL });
      await expect(
        originalBox,
        'the actual source line opens as an existing editable canvas box',
      ).toHaveCount(1);
      if (operation === 'replace') {
        await originalBox.dblclick();
        const typing = editor.locator('[data-editing="true"] .ProseMirror');
        await expect(typing).toBeVisible();
        // Chosen with the keys, as a person does: fill()'s DOM range can lose to the box's own check just
        // after it takes the keyboard, which puts the double-click's caret back.
        await expect(typing).toBeFocused();
        await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await ed.keyboard.insertText(REVISED);
        await expect(typing).toHaveText(REVISED);
        await ed.keyboard.press('Escape');
        await expect(typing).toHaveCount(0);
        await expect(editor.getByTestId('editor-slide')).toContainText(REVISED);
      } else {
        await originalBox.click();
        await ed.keyboard.press('Delete');
        await expect(originalBox).toHaveCount(0);
      }
      await editor.getByTestId('save-slides').click();
      await slideEditorClosed(app);
      sourceUnchanged();

      const words = await savedWords(win, id);
      expect(words).not.toContain(ORIGINAL);
      expect(words.filter((text) => text === REVISED)).toHaveLength(operation === 'replace' ? 1 : 0);
      // Preparing the editor must not silently convert an untouched page's saved playback.
      expect(untouchedRows(rawContent(userData, id))).toEqual(untouchedBefore);

      await win.getByTestId('edit-slides').click();
      const reopened = await slideEditorWindow(app);
      await expect(reopened.editor.getByTestId('editor-slide')).not.toContainText(ORIGINAL);
      if (operation === 'replace')
        await expect(reopened.editor.getByTestId('editor-slide')).toContainText(REVISED);
      expect(await savedWords(win, id)).toEqual(words);
      sourceUnchanged();
    } finally {
      // Source integrity is still checked when an editing assertion fails.
      try {
        await app.close();
      } finally {
        sourceUnchanged();
      }
    }
  });
}
