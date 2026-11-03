import { expect, test, type Locator } from '@playwright/test';
import { join } from 'node:path';
import { editorGroup } from './helpers';
import { drawPicture, halves } from './placeholder-slides';
import { importAndGetIds } from './helpers';
import { openGeneratedPdf } from './pdf-tools-fixtures';

async function frames(editor: Locator) {
  return editor
    .getByTestId('editor-slide')
    .locator('[data-element]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        if (!(node instanceof HTMLElement || node instanceof SVGElement))
          throw new Error('Missing native page element.');
        return {
          id: node.getAttribute('data-element'),
          x: parseFloat(node.style.left),
          y: parseFloat(node.style.top),
          width: parseFloat(node.style.width),
          height: parseFloat(node.style.height),
        };
      }),
    );
}

for (const kind of ['shape', 'table', 'timer', 'picture'] as const) {
  test(`Insert places a ${kind} inside the selected portrait PDF paper with one Undo`, async () => {
    const s = await openGeneratedPdf();
    try {
      await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
      const before = await frames(s.editor);
      await editorGroup(s.ed, 'Insert');
      if (kind === 'shape') {
        await s.editor.getByTestId('add-shape').click();
        await s.ed.getByRole('menuitem', { name: 'Arrow', exact: true }).click();
      } else if (kind === 'table') {
        await s.editor.getByTestId('add-table').click();
        await s.ed.getByTestId('table-rows').fill('2');
        await s.ed.getByTestId('table-columns').fill('2');
        await s.ed.getByRole('button', { name: 'Add table', exact: true }).click();
      } else if (kind === 'timer') {
        await s.editor.getByTestId('add-timer').click();
        await s.ed.getByRole('menuitem', { name: 'New timer…', exact: true }).click();
        await s.ed.getByRole('textbox', { name: 'Timer name', exact: true }).fill('Placeholder paper timer');
        await s.ed.getByTestId('timer-form').getByRole('button', { name: 'Save', exact: true }).click();
      } else {
        const file = await drawPicture(
          s.win,
          join(s.folder, 'Placeholder paper picture.png'),
          halves('10,60,130', '130,60,10'),
        );
        await importAndGetIds(s.win, [file]);
        await s.editor.getByTestId('add-media').click();
        await s.ed
          .getByTestId('media-picker')
          .getByRole('button', { name: /^Picture: Placeholder paper picture/ })
          .click();
        await expect(s.ed.getByTestId('media-picker')).toHaveCount(0);
      }
      const added = (await frames(s.editor)).filter((frame) => !before.some((old) => old.id === frame.id));
      expect(added).toHaveLength(kind === 'table' ? 8 : 1);
      for (const frame of added) {
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width, `${kind} fits the selected paper width`).toBeLessThanOrEqual(320);
        expect(frame.y + frame.height, `${kind} fits the selected paper height`).toBeLessThanOrEqual(480);
      }
      await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await frames(s.editor)).toEqual(before);
      await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
      expect((await frames(s.editor)).filter((frame) => added.some((old) => old.id === frame.id))).toEqual(
        added,
      );
      s.unchanged();
    } finally {
      await s.app.close();
      s.unchanged();
    }
  });
}

test('the selected PDF paper supplies initial guides and their limits', async () => {
  const s = await openGeneratedPdf();
  try {
    await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
    await editorGroup(s.ed, 'Arrange');
    await s.ed.getByRole('button', { name: 'Place guides…', exact: true }).click();
    const across = s.ed.getByRole('spinbutton', { name: 'Across guide 1', exact: true });
    const down = s.ed.getByRole('spinbutton', { name: 'Down guide 1', exact: true });
    await expect(across).toHaveValue('160');
    await expect(down).toHaveValue('240');
    await expect(across).toHaveAttribute('max', '320');
    await expect(down).toHaveAttribute('max', '480');
    await s.ed.getByRole('button', { name: 'Done', exact: true }).click();
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});
