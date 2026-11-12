import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { drawPicture, halves } from './placeholder-slides';

const title = 'Placeholder editor tools';

async function start() {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-disk-and-menu-'));
    const words = join(dir, `${title}.txt`);
    writeFileSync(words, 'Placeholder slide words');
    const [id] = await importAndGetIds(win, [words]);
    expect(id).toBeTruthy();
    await openLibrary(win);
    await win.getByTestId('presentation-row').filter({ hasText: title }).click();
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    return { app, win, ed, editor, id, dir };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test('a slide object’s right-click menu edits, copies, pastes, orders and removes objects', async () => {
  const { app, ed, editor } = await start();
  try {
    const canvas = editor.getByTestId('editor-canvas');
    const objects = editor.getByTestId('editor-slide').locator('[data-element]');
    const original = objects.first();
    const frame = await original.boundingBox();
    if (!frame) throw new Error('The generated text box did not render');
    const x = frame.x + frame.width / 2;
    const y = frame.y + frame.height / 2;
    const rightClick = () => ed.mouse.click(x, y, { button: 'right' });
    const menu = ed.getByRole('menu', { name: 'Slide objects' });
    const choose = (name: string) => menu.getByRole('menuitem', { name, exact: true }).click();
    await rightClick();
    await expect(menu).toBeVisible();
    await choose('Edit text');
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.fill('Placeholder edited from the menu');
    await typing.press('Escape');
    await expect(original).toContainText('Placeholder edited from the menu');

    await rightClick();
    await choose('Copy');
    await canvas.press('Shift+F10');
    await expect(menu).toBeVisible();
    await choose('Paste');
    await expect(objects).toHaveCount(2);
    const pastedId = await objects.nth(1).getAttribute('data-element');
    await canvas.press('Shift+F10');
    await choose('Send backward');
    await expect(objects.first()).toHaveAttribute('data-element', pastedId ?? '');

    await canvas.press('Shift+F10');
    await choose('Duplicate');
    await expect(objects).toHaveCount(3);
    await canvas.press('Shift+F10');
    await choose('Cut');
    await expect(objects).toHaveCount(2);
    await canvas.press('Shift+F10');
    await choose('Paste');
    await expect(objects).toHaveCount(3);
    await canvas.press('Shift+F10');
    await choose('Delete');
    await expect(objects).toHaveCount(2);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(objects).toHaveCount(3);

    await canvas.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await canvas.press('Shift+F10');
    await choose('Group');
    await canvas.press('Shift+F10');
    await expect(menu.getByRole('menuitem', { name: 'Ungroup' })).toBeEnabled();
    await choose('Ungroup');
    await canvas.press('Shift+F10');
    await expect(menu.getByRole('menuitem', { name: 'Ungroup' })).toBeDisabled();
    await ed.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(editor).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a picture can be picked from the computer or dropped directly on the slide', async () => {
  const { app, win, ed, editor, id, dir } = await start();
  try {
    const chosen = await drawPicture(
      win,
      join(dir, 'Placeholder chosen picture.png'),
      halves('230,50,40', '20,210,40'),
    );
    const dropped = await drawPicture(
      win,
      join(dir, 'Placeholder dropped picture.png'),
      halves('20,50,230', '220,160,40'),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, chosen);
    await editorGroup(ed, 'Insert');
    await editor.getByRole('button', { name: 'Picture from computer…' }).click();
    const pictures = editor.getByTestId('editor-slide').locator('[data-element][data-media-id]');
    await expect(pictures).toHaveCount(1);

    const canvas = await editor.getByTestId('editor-canvas').boundingBox();
    if (!canvas) throw new Error('The slide canvas did not render');
    const x = Math.round(canvas.x + canvas.width * 0.76);
    const y = Math.round(canvas.y + canvas.height * 0.67);
    const cdp = await ed.context().newCDPSession(ed);
    try {
      const data = { items: [], files: [dropped], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
        await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
    } finally {
      await cdp.detach();
    }
    await expect(pictures).toHaveCount(2);
    const placed = await pictures.nth(1).boundingBox();
    if (!placed) throw new Error('The dropped picture did not render');
    expect(Math.abs(placed.x + placed.width / 2 - x)).toBeLessThan(6);
    expect(Math.abs(placed.y + placed.height / 2 - y)).toBeLessThan(6);
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (presentationId) => (globalThis as PageGlobals).drashti.library.slidesForEdit(presentationId),
      id ?? '',
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(
      saved.doc.groups[0]?.slides[0]?.elements.filter((element) => element.kind === 'image'),
    ).toHaveLength(2);
  } finally {
    await app.close();
  }
});
