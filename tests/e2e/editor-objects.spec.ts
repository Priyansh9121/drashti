import { expect, test, type Locator } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';

const name = 'Placeholder overlapping objects';
const back = 'Placeholder back box';
const middle = 'Placeholder middle box';
const front = 'Placeholder front box';
const member = 'Placeholder group member';
const sibling = 'Placeholder group sibling';
const filledWords = 'Placeholder words on fill';
const hiddenName = 'Placeholder hidden source object';
const hiddenWords = 'Placeholder hidden source words';

function box(
  id: number,
  words: string,
  x: number,
  y: number,
  options: { bullet?: boolean; name?: string; hidden?: boolean; filled?: boolean } = {},
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${options.name ?? words}"${options.hidden ? ' hidden="1"' : ''}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(x)}" y="${String(y)}"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${options.filled ? '<a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill>' : ''}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${options.bullet ? '<a:pPr marL="380000" indent="-380000"><a:buChar char="•"/></a:pPr>' : ''}<a:r><a:rPr sz="2800"/><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function fixture({ hidden, filled }: { hidden?: boolean; filled?: boolean }): string {
  const group = [
    '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Placeholder group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '<p:grpSpPr><a:xfrm><a:off x="6400800" y="914400"/><a:ext cx="3657600" cy="2743200"/><a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="2743200"/></a:xfrm></p:grpSpPr>',
    box(11, member, 0, 0, { bullet: true }),
    box(12, sibling, 0, 1371600),
    '</p:grpSp>',
  ].join('');
  const shapes = [
    box(2, back, 914400, 2743200),
    box(3, middle, 914400, 2743200),
    box(4, front, 914400, 2743200),
    group,
    ...(hidden ? [box(13, hiddenWords, 914400, 914400, { name: hiddenName, hidden: true })] : []),
    ...(filled ? [box(14, filledWords, 6400800, 4114800, { filled: true })] : []),
  ].join('');
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-objects-')), `${name}.pptx`);
  writeFileSync(file, editablePptxFixture({ slides: [slideXml(shapes)] }));
  return file;
}

async function openSource(file: string, title: string, env: Record<string, string>) {
  const { app } = await launchApp(env);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id] = await importAndGetIds(win, [file]);
    if (!id) throw new Error('The generated document was not imported');
    await openLibrary(win);
    await win.getByTestId('presentation-row').filter({ hasText: title }).click();
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    return { app, win, ed, editor, id };
  } catch (error) {
    await app.close();
    throw error;
  }
}

function openFixture(options: Parameters<typeof fixture>[0] = {}) {
  return openSource(fixture(options), name, { DRASHTI_TEST_DECK_CONVERTER: '1' });
}

const paneOf = (editor: Locator) => editor.getByTestId('editor-objects');
const canvasOf = (editor: Locator) => editor.getByTestId('editor-slide');
const boxOf = (editor: Locator, words: string) =>
  canvasOf(editor).locator('[data-element]').filter({ hasText: words });
const selectObject = (editor: Locator, object: string) =>
  paneOf(editor).getByRole('button', { name: object, exact: true });

async function objectBounds(editor: Locator, words: string) {
  const box = boxOf(editor, words);
  await expect(box).toBeVisible();
  const bounds = await box.boundingBox();
  if (!bounds) throw new Error('The generated text box did not render');
  return bounds;
}

test('Edit slides reaches overlapping source boxes and group members and keeps their order on save', async () => {
  const { app, win, ed, editor } = await openFixture();
  try {
    const objects = paneOf(editor);
    const overlap = await objectBounds(editor, front);
    const x = overlap.x + overlap.width / 2;
    const y = overlap.y + overlap.height / 2;
    for (const words of [front, middle, back, front]) {
      await ed.mouse.click(x, y);
      await expect(selectObject(editor, words)).toHaveAttribute('aria-pressed', 'true');
    }

    await selectObject(editor, member).click();
    await expect(selectObject(editor, member)).toHaveAttribute('aria-pressed', 'true');
    await expect(selectObject(editor, sibling)).toHaveAttribute('aria-pressed', 'false');
    await boxOf(editor, member).dblclick();
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await expect(typing).toContainText(member);
    await typing.press('Escape');

    await selectObject(editor, middle).click();
    await objects.getByRole('button', { name: 'Bring forward', exact: true }).click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);

    await win.getByTestId('edit-slides').click();
    const { editor: reopened } = await slideEditorWindow(app);
    const order = await reopened.getByTestId('editor-object').allTextContents();
    expect(order.findIndex((row) => row.includes(middle))).toBeLessThan(
      order.findIndex((row) => row.includes(front)),
    );
  } finally {
    await app.close();
  }
});

test('double-click edits the front box after cycling through the overlapping boxes', async () => {
  const { app, ed, editor } = await openFixture();
  try {
    const overlap = await objectBounds(editor, front);
    const x = overlap.x + overlap.width / 2;
    const y = overlap.y + overlap.height / 2;
    for (const words of [front, middle, back, front]) {
      await ed.mouse.click(x, y);
      await expect(selectObject(editor, words)).toHaveAttribute('aria-pressed', 'true');
    }
    await ed.mouse.dblclick(x, y);
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expect(editor.getByTestId('text-editing')).toHaveText(front);
  } finally {
    await app.close();
  }
});

test('a second canvas click picks a group member on its own', async () => {
  const { app, ed, editor } = await openFixture();
  try {
    const bounds = await objectBounds(editor, member);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await ed.mouse.click(x, y);
    await expect(selectObject(editor, member)).toHaveAttribute('aria-pressed', 'true');
    await expect(selectObject(editor, sibling)).toHaveAttribute('aria-pressed', 'true');
    await ed.mouse.click(x, y);
    await expect(selectObject(editor, member)).toHaveAttribute('aria-pressed', 'true');
    await expect(selectObject(editor, sibling)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await app.close();
  }
});

test('a click then double-click edits the words over their source fill', async () => {
  const { app, ed, editor } = await openFixture({ filled: true });
  try {
    await expect(canvasOf(editor).locator('[data-shape]')).toHaveCount(1);
    const bounds = await objectBounds(editor, filledWords);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await ed.mouse.click(x, y);
    await expect(editor.getByTestId('selection')).toHaveAttribute(
      'data-selected',
      (await boxOf(editor, filledWords).getAttribute('data-element')) ?? '',
    );
    await ed.mouse.dblclick(x, y);
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expect(editor.getByTestId('text-editing')).toHaveText(filledWords);
  } finally {
    await app.close();
  }
});

test('a double-click at a text box corner still edits after its resize handle appears', async () => {
  const { app, ed, editor } = await openFixture();
  try {
    const bounds = await objectBounds(editor, front);
    await expect(editor.getByTestId('handle-nw')).toHaveCount(0);
    // This point is inside the box and within its 10 px corner handle once the first press selects it.
    await ed.mouse.dblclick(bounds.x + 2, bounds.y + 2);
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expect(editor.getByTestId('text-editing')).toHaveText(front);
  } finally {
    await app.close();
  }
});

test('a click then double-click edits the PDF words over the page picture', async () => {
  const title = 'Placeholder PDF overlap';
  const words = 'Placeholder PDF words MMMMMM';
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-objects-pdf-')), `${title}.pdf`);
  writeFileSync(file, makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0], text: words }]));
  const { app, ed, editor } = await openSource(file, title, { DRASHTI_TEST_NO_CONVERTER: '1' });
  try {
    await expect(canvasOf(editor).locator('[data-element][data-media-id]')).toHaveCount(1);
    const bounds = await objectBounds(editor, words);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await ed.mouse.click(x, y);
    await expect(editor.getByTestId('selection')).toHaveAttribute(
      'data-selected',
      (await boxOf(editor, words).getAttribute('data-element')) ?? '',
    );
    await ed.mouse.dblclick(x, y);
    await expect(editor.getByTestId('text-editing')).toBeFocused();
    await expect(editor.getByTestId('text-editing')).toHaveText(words);
  } finally {
    await app.close();
  }
});

test('hidden objects stay out of Select All and Tab on the canvas', async () => {
  const { app, ed, editor } = await openFixture({ hidden: true });
  try {
    const canvas = editor.getByTestId('editor-canvas');
    const hidden = selectObject(editor, hiddenName);
    await canvas.focus();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await expect.soft(selectObject(editor, front)).toHaveAttribute('aria-pressed', 'true');
    await expect.soft(hidden).toHaveAttribute('aria-pressed', 'false');

    await selectObject(editor, sibling).click();
    await canvas.focus();
    await ed.keyboard.press('Tab');
    await expect(hidden).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await app.close();
  }
});

test('double-clicking a hidden object explains how to edit it', async () => {
  const { app, editor } = await openFixture({ hidden: true });
  try {
    await selectObject(editor, hiddenName).dblclick();
    await expect(editor.getByTestId('text-editing')).toHaveCount(0);
    await expect(editor.getByTestId('editor-note')).toContainText(/show.+(?:edit|first|typing)/iu);
  } finally {
    await app.close();
  }
});

test('source object names and visibility survive saving, the audience and reopening', async () => {
  const { app, win, editor, id } = await openFixture({ hidden: true });
  const reopen = async () => {
    await win.getByTestId('edit-slides').click();
    return (await slideEditorWindow(app)).editor;
  };
  const save = async (view: Locator) => {
    await view.getByTestId('save-slides').click();
    await slideEditorClosed(app);
  };
  try {
    const pane = paneOf(editor);
    const hiddenRow = pane.getByTestId('editor-object').filter({ hasText: hiddenName });
    await expect(hiddenRow).toHaveAttribute('data-hidden', 'true');
    await expect(boxOf(editor, hiddenWords)).toHaveCount(0);
    await pane.getByRole('button', { name: `Show ${hiddenName}`, exact: true }).click();
    await expect(boxOf(editor, hiddenWords)).toBeVisible();
    await pane.getByRole('button', { name: `Hide ${front}`, exact: true }).click();
    await expect(boxOf(editor, front)).toHaveCount(0);

    await save(editor);
    await setUpScreen(win, 'Placeholder audience');
    const output = await outputPage(app);
    const shown = await win.evaluate(
      (presentationId) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId,
          slideIndex: 0,
        }),
      id,
    );
    expect(shown.ok).toBe(true);
    const hall = output.locator('[data-layer="slide"]');
    await expect(hall).toContainText(hiddenWords);
    await expect(hall).not.toContainText(front);
    const cleared = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }),
    );
    expect(cleared.ok).toBe(true);

    const reopened = await reopen();
    await expect(boxOf(reopened, hiddenWords)).toBeVisible();
    await expect(boxOf(reopened, front)).toHaveCount(0);
    await paneOf(reopened)
      .getByRole('button', { name: `Show ${front}`, exact: true })
      .click();
    await save(reopened);
    await expect(boxOf(await reopen(), front)).toBeVisible();
  } finally {
    await app.close();
  }
});
