import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';

const name = 'Placeholder overlapping objects';
const back = 'Placeholder back box';
const middle = 'Placeholder middle box';
const front = 'Placeholder front box';
const member = 'Placeholder group member';

function box(
  id: number,
  words: string,
  x: number,
  y: number,
  options: { bullet?: boolean; name?: string; hidden?: boolean } = {},
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${options.name ?? words}"${options.hidden ? ' hidden="1"' : ''}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(x)}" y="${String(y)}"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${options.bullet ? '<a:pPr marL="380000" indent="-380000"><a:buChar char="•"/></a:pPr>' : ''}<a:r><a:rPr sz="2800"/><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function fixture(withHidden: boolean): string {
  const group = [
    '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Placeholder group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '<p:grpSpPr><a:xfrm><a:off x="6400800" y="914400"/><a:ext cx="3657600" cy="2743200"/><a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="2743200"/></a:xfrm></p:grpSpPr>',
    box(11, member, 0, 0, { bullet: true }),
    box(12, 'Placeholder group sibling', 0, 1371600),
    '</p:grpSp>',
  ].join('');
  const shapes = [
    box(2, back, 914400, 2743200),
    box(3, middle, 914400, 2743200),
    box(4, front, 914400, 2743200),
    group,
    ...(withHidden
      ? [
          box(13, 'Placeholder hidden source words', 914400, 914400, {
            name: 'Placeholder hidden source object',
            hidden: true,
          }),
        ]
      : []),
  ].join('');
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-objects-')), `${name}.pptx`);
  writeFileSync(file, editablePptxFixture({ slides: [slideXml(shapes)] }));
  return file;
}

async function openFixture(withHidden = false) {
  const file = fixture(withHidden);
  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id] = await importAndGetIds(win, [file]);
    expect(id).toBeTruthy();
    await openLibrary(win);
    await win.getByTestId('presentation-row').filter({ hasText: name }).click();
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    return { app, win, ed, editor };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test('Edit slides reaches overlapping source boxes and group members and keeps their order on save', async () => {
  const { app, win, ed, editor } = await openFixture();
  try {
    const canvas = editor.getByTestId('editor-slide');
    const objects = editor.getByTestId('editor-objects');
    const selectObject = (words: string) => objects.getByTestId('object-select').filter({ hasText: words });
    const objectBox = (words: string) => canvas.locator('[data-element]').filter({ hasText: words });
    await expect(selectObject(front)).toBeVisible();
    const overlap = await objectBox(front).boundingBox();
    if (!overlap) throw new Error('The generated front box did not render');
    const x = overlap.x + overlap.width / 2;
    const y = overlap.y + overlap.height / 2;
    for (const words of [front, middle, back, front]) {
      await ed.mouse.click(x, y);
      await expect(selectObject(words)).toHaveAttribute('aria-pressed', 'true');
    }

    await selectObject(member).click();
    await expect(selectObject(member)).toHaveAttribute('aria-pressed', 'true');
    await expect(selectObject('Placeholder group sibling')).toHaveAttribute('aria-pressed', 'false');
    await objectBox(member).dblclick();
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await expect(typing).toContainText(member);
    await typing.press('Escape');

    await selectObject(middle).click();
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

test('source object names and visibility survive saving and reopening', async () => {
  const { app, win, editor } = await openFixture(true);
  const hiddenName = 'Placeholder hidden source object';
  const hiddenWords = 'Placeholder hidden source words';
  const paneOf = (view: typeof editor) => view.getByTestId('editor-objects');
  const boxOf = (view: typeof editor, words: string) =>
    view.getByTestId('editor-slide').locator('[data-element]').filter({ hasText: words });
  const save = async (view: typeof editor) => {
    await view.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    await win.getByTestId('edit-slides').click();
    return (await slideEditorWindow(app)).editor;
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

    const reopened = await save(editor);
    await expect(boxOf(reopened, hiddenWords)).toBeVisible();
    await expect(boxOf(reopened, front)).toHaveCount(0);
    await paneOf(reopened)
      .getByRole('button', { name: `Show ${front}`, exact: true })
      .click();
    const savedAgain = await save(reopened);
    await expect(boxOf(savedAgain, front)).toBeVisible();
  } finally {
    await app.close();
  }
});
