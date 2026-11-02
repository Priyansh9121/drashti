import { expect, test, type Locator, type Page } from '@playwright/test';
import type { NativePath } from '../../src/shared/model';
import { rawContent } from './deck-edit-fixtures';
import { slideEditorClosed, slideEditorWindow } from './helpers';
import { openGeneratedPdf, PDF_LABELS, requiredAt, usePdfTools } from './pdf-tools-fixtures';

const nativeIds = async (editor: Locator): Promise<string[]> =>
  editor
    .getByTestId('editor-slide')
    .locator('[data-element]')
    .evaluateAll((nodes) => [
      ...new Set(
        nodes.flatMap((node) => {
          const id = node.getAttribute('data-element');
          return id ? [id] : [];
        }),
      ),
    ]);

async function pageBounds(editor: Locator) {
  const box = await editor.getByTestId('editor-slide').boundingBox();
  if (!box) throw new Error('Generated PDF page has no visible canvas.');
  return box;
}

async function region(ed: Page, editor: Locator, from: [number, number], to: [number, number]) {
  const box = await pageBounds(editor);
  await ed.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await ed.mouse.down();
  await ed.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 12 });
  await ed.mouse.up();
}

function storedDrawing(userData: string, presentationId: string, id: string): NativePath {
  const row = rawContent(userData, presentationId).elements.find((element) => element['id'] === id);
  if (!row) throw new Error('New generated drawing was not saved as an element.');
  expect(row['kind']).toBe('shape');
  const props = JSON.parse(String(row['props'])) as { shape?: string; path?: NativePath };
  expect(props.shape).toBe('path');
  if (!props.path) throw new Error('Saved drawing lost its native path.');
  return props.path;
}

test('a PDF drawing keeps its real bend through one Undo, cancel and saving without changing its original', async () => {
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    const draw = s.ed.getByRole('button', { name: PDF_LABELS.draw, exact: true });
    // Actual existing UI assertion: the reviewed toolbar's Draw is disabled
    // before Canvas tool implementation. No new IPC/export/module is invoked.
    await expect(draw, 'Draw must create native editable page content').toBeEnabled();
    const before = await nativeIds(s.editor);
    const undo = s.ed.getByRole('button', { name: 'Undo', exact: true });
    const redo = s.ed.getByRole('button', { name: 'Redo', exact: true });
    await expect(undo).toBeDisabled();
    const box = await pageBounds(s.editor);
    const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
    const bend = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.68 };
    const end = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.25 };

    await draw.click();
    await s.ed.mouse.move(start.x, start.y);
    await s.ed.mouse.down();
    await s.ed.mouse.move(bend.x, bend.y, { steps: 8 });
    await expect(s.ed.getByTestId('pdf-mark-preview')).toBeVisible();
    expect(await nativeIds(s.editor), 'a pointer preview has no committed page element').toEqual(before);
    await expect(undo).toBeDisabled();
    await s.ed.keyboard.press('Escape');
    await s.ed.mouse.up();
    await expect(s.ed.getByTestId('pdf-mark-preview')).toHaveCount(0);
    expect(await nativeIds(s.editor)).toEqual(before);
    await expect(undo).toBeDisabled();
    s.unchanged();

    await draw.click();
    await s.ed.mouse.move(start.x, start.y);
    await s.ed.mouse.down();
    await s.ed.mouse.move(bend.x, bend.y, { steps: 8 });
    await s.ed.mouse.move(end.x, end.y, { steps: 8 });
    await s.ed.mouse.up();
    const added = async () => (await nativeIds(s.editor)).filter((id) => !before.includes(id));
    await expect.poll(added).toHaveLength(1);
    const id = requiredAt(await added(), 0, 'new drawing id');
    const drawing = s.editor.getByTestId('editor-slide').locator(`[data-element="${id}"]`);
    await expect(drawing).toHaveAttribute('data-shape', 'path');
    await expect(drawing.locator('path')).toHaveAttribute('d', /M.+L.+L/u);
    await undo.click();
    expect(await nativeIds(s.editor)).toEqual(before);
    await expect(undo, 'one Undo removes the whole completed stroke').toBeDisabled();
    await redo.click();
    await expect(drawing).toBeVisible();
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    s.unchanged();

    const path = storedDrawing(s.userData, s.id, id);
    const points = path.commands.filter((command) => command.op !== 'Z');
    const first = requiredAt(points, 0, 'first saved drawing point');
    const middle = requiredAt(points, Math.floor(points.length / 2), 'middle saved drawing point');
    const last = requiredAt(points, points.length - 1, 'last saved drawing point');
    const bendArea = Math.abs(
      (middle.x - first.x) * (last.y - first.y) - (middle.y - first.y) * (last.x - first.x),
    );
    expect(
      bendArea,
      'the saved native stroke preserves the bend rather than an endpoint chord',
    ).toBeGreaterThan(0.1);
    await s.win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(s.app);
    await expect(
      reopened.editor.getByTestId('editor-slide').locator(`[data-element="${id}"]`),
    ).toHaveAttribute('data-shape', 'path');
    s.unchanged();
  } finally {
    try {
      await s.app.close();
    } finally {
      s.unchanged();
    }
  }
});

test('PDF highlight and visual cover are distinct editable page regions with independent Undo', async () => {
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    const highlight = s.ed.getByRole('button', { name: PDF_LABELS.highlight, exact: true });
    await expect(highlight, 'Highlight must mark an explicitly drawn page region').toBeEnabled();
    const before = await nativeIds(s.editor);
    await highlight.click();
    await region(s.ed, s.editor, [0.16, 0.28], [0.6, 0.4]);
    const highlights = (await nativeIds(s.editor)).filter((id) => !before.includes(id));
    expect(highlights).toHaveLength(1);
    const highlightId = requiredAt(highlights, 0, 'new highlight id');
    const marked = s.editor.getByTestId('editor-slide').locator(`[data-element="${highlightId}"]`);
    const opacity = await marked.evaluate((node) => Number(getComputedStyle(node).opacity));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity, 'highlight leaves the underlying page visible').toBeLessThan(1);

    const cover = s.ed.getByRole('button', { name: PDF_LABELS.cover, exact: true });
    await expect(cover).toBeEnabled();
    await cover.click();
    await region(s.ed, s.editor, [0.65, 0.6], [0.88, 0.8]);
    const covers = (await nativeIds(s.editor)).filter((id) => !before.includes(id) && id !== highlightId);
    expect(covers).toHaveLength(1);
    const coverId = requiredAt(covers, 0, 'new visual cover id');
    const covered = s.editor.getByTestId('editor-slide').locator(`[data-element="${coverId}"]`);
    expect(await covered.evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(covered).toHaveCount(0);
    await expect(marked).toBeVisible();
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await nativeIds(s.editor)).toEqual(before);
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    s.unchanged();
  } finally {
    try {
      await s.app.close();
    } finally {
      s.unchanged();
    }
  }
});
