import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  editablePptxFixture,
  REL_NS,
  relationshipsXml,
  slideXml,
  wordsShape,
} from '../../src/main/import/testing/editable-pptx-fixture';
import { hashFile, openEditor, publicSlides, rawContent } from './deck-edit-fixtures';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
} from './helpers';

const text = (words: string) => '<a:r><a:rPr sz="1800"/><a:t>' + words + '</a:t></a:r>';
const hidden = wordsShape('<a:p>' + text('Placeholder hidden drawing') + '</a:p>').replace(
  'id="2" name="Placeholder words"',
  'id="2" name="Placeholder hidden drawing" hidden="1"',
);
const boxes = wordsShape(
  '<a:p><a:pPr algn="just"><a:spcBef><a:spcPts val="1800"/></a:spcBef><a:spcAft><a:spcPts val="2400"/></a:spcAft></a:pPr>' +
    text('Placeholder justified words') +
    '</a:p><a:p><a:pPr algn="r"><a:spcBef><a:spcPts val="1200"/></a:spcBef></a:pPr>' +
    text('Placeholder aligned right') +
    '</a:p><a:p><a:pPr><a:buClr><a:srgbClr val="336699"/></a:buClr><a:buSzPts val="1350"/>' +
    '<a:buChar char="◆"/></a:pPr>' +
    text('Placeholder styled bullet') +
    '</a:p><a:p><a:pPr><a:buAutoNum type="romanUcPeriod" startAt="4"/></a:pPr>' +
    text('Placeholder Roman item') +
    '</a:p>',
)
  .replace('id="2"', 'id="3"')
  .replace('cy="914400"', 'cy="1371600"');
const graphic = (id: string, x: string, data: string) =>
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' +
  id +
  '" name="Placeholder graphic"/></p:nvGraphicFramePr><p:xfrm><a:off x="' +
  x +
  '" y="914400"/><a:ext cx="3048000" cy="609600"/></p:xfrm><a:graphic><a:graphicData>' +
  data +
  '</a:graphicData></a:graphic></p:graphicFrame>';
const cell = (words: string, borders = '', directFill = true) =>
  '<a:tc><a:txBody><a:bodyPr/><a:p>' +
  text(words) +
  '</a:p></a:txBody><a:tcPr>' +
  borders +
  (directFill ? '<a:solidFill><a:srgbClr val="eeeeee"/></a:solidFill>' : '') +
  '</a:tcPr></a:tc>';
const tableStyleId = '{01234567-89AB-CDEF-0123-456789ABCDEF}';
const tableStyles = `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${tableStyleId}">
  <a:tblStyle styleId="${tableStyleId}" styleName="Placeholder"><a:wholeTbl><a:tcStyle><a:fill>
    <a:solidFill><a:srgbClr val="41678A"/></a:solidFill>
  </a:fill></a:tcStyle></a:wholeTbl></a:tblStyle></a:tblStyleLst>`;
const table = graphic(
  '6',
  '914400',
  `<a:tbl><a:tblPr><a:tableStyleId>${tableStyleId}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1524000"/><a:gridCol w="1524000"/></a:tblGrid><a:tr h="609600">` +
    cell(
      'Placeholder first cell',
      '<a:lnL w="19050"><a:solidFill><a:srgbClr val="AA2244"/></a:solidFill></a:lnL>',
    ) +
    cell(
      'Placeholder second cell',
      '<a:lnT><a:noFill/></a:lnT><a:lnB w="38100"><a:solidFill><a:srgbClr val="22AA44"/></a:solidFill></a:lnB>',
      false,
    ) +
    '</a:tr></a:tbl>',
);
const chart = graphic('7', '5486400', '<c:chart xmlns:c="c" r:id="rUnavailable"/>');
const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';

test('a PowerPoint slide keeps its editable cells, aligned words and hidden objects beside a picture fallback', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const file = join(userData, 'Placeholder fidelity.pptx');
    writeFileSync(
      file,
      editablePptxFixture({
        slides: [slideXml(hidden + boxes + table + chart)],
        parts: {
          'ppt/tableStyles.xml': tableStyles,
          'ppt/_rels/presentation.xml.rels': relationshipsXml(
            `<Relationship Id="rId1" Type="${REL_NS}/slide" Target="slides/slide1.xml"/>` +
              `<Relationship Id="rIdStyle" Type="${REL_NS}/tableStyles" Target="tableStyles.xml"/>`,
          ),
        },
      }),
    );
    const checksum = hashFile(file);
    const win = await operatorPage(app);
    await operatorReady(win);
    const [presentationId] = await importAndGetIds(win, [file]);
    if (!presentationId) throw new Error('The generated presentation was not imported.');
    const { ed, editor } = await openEditor(app, win, 'Placeholder fidelity');
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    const canvas = editor.getByTestId('editor-slide');
    await expect(canvas.getByText('Placeholder hidden drawing', { exact: true })).toHaveCount(0);
    await expect(canvas.getByText('Placeholder justified words', { exact: true }).locator('..')).toHaveCSS(
      'text-align',
      'justify',
    );
    await expect(canvas.getByText('Placeholder aligned right', { exact: true }).locator('..')).toHaveCSS(
      'text-align',
      'right',
    );
    const justified = canvas.getByText('Placeholder justified words', { exact: true });
    await expect(justified.locator('..')).toHaveCSS('padding-block-start', '0px');
    const afterInEm = await justified.evaluate(
      (element) =>
        Number.parseFloat(getComputedStyle(element.parentElement ?? element).paddingBlockEnd) /
        Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(afterInEm).toBeCloseTo(32 / 24, 2);
    const right = canvas.getByText('Placeholder aligned right', { exact: true });
    const beforeInEm = await right.evaluate(
      (element) =>
        Number.parseFloat(getComputedStyle(element.parentElement ?? element).paddingBlockStart) /
        Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(beforeInEm).toBeCloseTo(16 / 24, 2);
    const fittedBox = justified.locator('xpath=ancestor::*[@data-element][1]');
    await expect(fittedBox).toHaveAttribute('data-fit', /^0\.[0-9]+$/u);
    const bullet = canvas.locator('[data-list-marker="disc"]');
    const bulletWords = canvas.getByText('Placeholder styled bullet', { exact: true });
    await expect(bullet).toHaveText('◆');
    await expect(canvas.locator('[data-list-marker="I"]')).toHaveText('IV.');
    await expect(bullet).toHaveCSS('color', 'rgb(51, 102, 153)');
    const markerPx = await bullet.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    const wordsPx = await bulletWords.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(markerPx / wordsPx).toBeCloseTo(0.75, 2);
    await expect(canvas.locator('[data-slide-crop]')).toHaveCount(1);
    await expect(canvas.locator('[data-shape="line"] line')).toHaveCount(2);
    await expect(canvas.locator('line[stroke="#aa2244"]')).toHaveAttribute('stroke-width', '2');
    await expect(canvas.locator('line[stroke="#22aa44"]')).toHaveAttribute('stroke-width', '4');
    await expect(canvas.locator('[data-shape="rectangle"] rect[fill="#41678a"]')).toHaveCount(1);
    await expect(canvas.locator('[data-shape="rectangle"] rect[fill="#eeeeee"]')).toHaveCount(1);

    await canvas.getByText('Placeholder second cell', { exact: true }).dblclick();
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.press(shortcut + '+A');
    await ed.keyboard.insertText('Placeholder cell edited');
    await expect(typing).toHaveText('Placeholder cell edited');
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);

    const [saved] = await publicSlides(win, presentationId);
    const elements = saved?.slide.elements ?? [];
    expect(elements.some((element) => element.sourceShapeId === '2')).toBe(false);
    const stored = rawContent(userData, presentationId).elements.flatMap((row) =>
      typeof row['props'] === 'string'
        ? [JSON.parse(row['props']) as { sourceShapeId?: string; hidden?: boolean }]
        : [],
    );
    expect(stored.find((element) => element.sourceShapeId === '2')).toMatchObject({ hidden: true });
    expect(
      elements.find((element) => element.kind === 'text' && element.text === 'Placeholder cell edited'),
    ).toMatchObject({ sourceShapeId: '6', tableCell: { row: 0, column: 1, rowSpan: 1, columnSpan: 1 } });
    const picture = elements.find((element) => element.kind === 'image' && element.sourceShapeId === '7');
    expect(picture?.kind === 'image' && picture.crop?.width).toBeGreaterThan(0);
    expect(hashFile(file)).toBe(checksum);
  } finally {
    await app.close();
  }
});

test('tight imported PowerPoint boxes and table cells fit their words on both writing axes', async () => {
  const line = 'Placeholder unwrapped line that is wider than its source text box';
  const column = 'Placeholder vertical first column';
  const cellWords = 'Placeholder words that wrap inside a narrow table cell';
  const horizontal = wordsShape(
    '<a:p><a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr>' + text(line) + '</a:p>',
    '<a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="1524000" cy="381000"/></a:xfrm>',
  ).replace('bIns="0"/>', 'bIns="0" wrap="none"><a:spAutoFit/></a:bodyPr>');
  const vertical = wordsShape(
    '<a:p>' + text(column) + '</a:p><a:p>' + text('Placeholder vertical second column') + '</a:p>',
    '<a:xfrm><a:off x="5486400" y="1828800"/><a:ext cx="381000" cy="3048000"/></a:xfrm>',
  )
    .replace('id="2"', 'id="3"')
    .replace('<a:bodyPr ', '<a:bodyPr vert="vert" ');
  const tightTable = graphic(
    '6',
    '3200400',
    '<a:tbl><a:tblGrid><a:gridCol w="1524000"/><a:gridCol w="1524000"/></a:tblGrid><a:tr h="609600">' +
      cell(cellWords) +
      cell('Placeholder other cell') +
      '</a:tr></a:tbl>',
  );

  const { app, userData } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  try {
    const name = 'Placeholder text fit';
    const file = join(userData, name + '.pptx');
    writeFileSync(file, editablePptxFixture({ slides: [slideXml(horizontal + vertical + tightTable)] }));
    const win = await operatorPage(app);
    await operatorReady(win);
    const [presentationId] = await importAndGetIds(win, [file]);
    expect(presentationId).toBeTruthy();
    const { editor } = await openEditor(app, win, name);
    const canvas = editor.getByTestId('editor-slide');
    for (const words of [line, column, cellWords]) {
      const box = canvas.locator('[data-element]').filter({ hasText: words });
      await expect(box.getByText(words, { exact: true })).toBeVisible();
      await expect(box).toHaveAttribute('data-fit', /^0\./u);
      await expect(box).not.toHaveAttribute('data-overset');
      await expect(box).toHaveCSS('overflow', 'visible');
      expect(
        await box.evaluate((element) => {
          const contents = element.firstElementChild;
          return (
            contents instanceof HTMLElement &&
            contents.scrollWidth <= element.clientWidth + 1 &&
            contents.scrollHeight <= element.clientHeight + 1
          );
        }),
      ).toBe(true);
    }
    await expect(canvas.locator('[data-element]').filter({ hasText: line })).toHaveCSS('white-space', 'pre');
    await expect(canvas.locator('[data-line]').filter({ hasText: line })).toHaveAttribute(
      'style',
      /line-height: 1\.08/u,
    );
  } finally {
    await app.close();
  }
});
