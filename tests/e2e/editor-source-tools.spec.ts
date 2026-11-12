import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  editablePptxFixture,
  slideXml,
  wordsShape,
} from '../../src/main/import/testing/editable-pptx-fixture';
import { openEditor, publicSlides } from './deck-edit-fixtures';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
} from './helpers';

const name = 'Placeholder editor source tools';
const boxWords = 'Placeholder imported paragraph';
const missingFont = 'Placeholder Missing Editor Font';

function table(): string {
  const cells = ['Placeholder left cell', 'Placeholder right cell'].map(
    (text) =>
      `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:tcPr></a:tc>`,
  );
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Placeholder table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3048000" cy="609600"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="1524000"/><a:gridCol w="1524000"/></a:tblGrid><a:tr h="609600">${cells.join('')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

test('the editor offers source table cells, text direction, paragraph styling and installed fonts', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const file = join(userData, `${name}.pptx`);
    const words = wordsShape(
      `<a:p><a:pPr algn="just" marL="380000" indent="-380000"><a:buChar char="◇"/></a:pPr><a:r><a:rPr sz="1800"><a:latin typeface="${missingFont}"/></a:rPr><a:t>${boxWords}</a:t></a:r></a:p>`,
    )
      .replace('name="Placeholder words"', 'name="Placeholder paragraph box"')
      .replace('<a:bodyPr ', '<a:bodyPr vert="vert" ');
    writeFileSync(file, editablePptxFixture({ slides: [slideXml(words + table())] }));
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id] = await importAndGetIds(win, [file]);
    if (!id) throw new Error('The generated source deck was not imported');
    const { ed, editor } = await openEditor(app, win, name);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    const inspector = editor.getByTestId('inspector');
    await expect(inspector.getByRole('status').filter({ hasText: missingFont })).toContainText('Install');
    const canvas = editor.getByTestId('editor-slide');
    await canvas.getByText('Placeholder left cell', { exact: true }).click();
    await inspector.getByRole('button', { name: 'Edit row 1, column 2' }).click();
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.fill('Placeholder updated cell');
    await typing.press('Escape');

    const pane = editor.getByTestId('editor-objects');
    await pane.getByRole('button', { name: 'Placeholder paragraph box', exact: true }).click();
    const direction = inspector.getByRole('combobox', { name: 'Text direction' });
    await expect(direction).toHaveValue('vertical-rl');
    await direction.selectOption('horizontal');
    await editorGroup(ed, 'Words');
    await expect(
      editor.getByTestId('field-font').locator('optgroup[label="On this computer"] option').first(),
    ).toBeAttached();
    await canvas.getByText(boxWords, { exact: true }).dblclick();
    await expect(typing).toBeFocused();
    await expect(typing.locator('[data-words]')).toHaveCSS('text-align', 'justify');
    await expect(typing.locator('[data-list-marker]')).toHaveText('◇');
    await typing.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await ed.keyboard.insertText('Placeholder paragraph revised');
    await editor.getByTestId('words-align-right').click();
    await expect(typing.locator('[data-words]')).toHaveCSS('text-align', 'right');

    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const [saved] = await publicSlides(win, id);
    expect(saved?.slide.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'text',
          text: 'Placeholder updated cell',
          tableCell: expect.objectContaining({ row: 0, column: 1 }),
        }),
        expect.objectContaining({
          kind: 'text',
          text: 'Placeholder paragraph revised',
          style: expect.not.objectContaining({ writingMode: 'vertical-rl' }),
          runs: expect.arrayContaining([
            expect.objectContaining({
              paragraph: expect.objectContaining({ align: 'right', bullet: '◇' }),
            }),
          ]),
        }),
      ]),
    );
  } finally {
    await app.close();
  }
});
