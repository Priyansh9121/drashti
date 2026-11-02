import { expect, test, type Locator, type Page } from '@playwright/test';
import type { NativePath } from '../../src/shared/model';
import { slideElementSchema } from '../../src/shared/model-schema';
import { nativePathData } from '../../src/shared/shape-path';
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

interface DrawingSnapshot {
  width: number;
  height: number;
  d: string;
  fill: string | null;
  stroke: string | null;
  strokeWidth: string | null;
  fillRule: string | null;
  lineCap: string | null;
  lineJoin: string | null;
  left: string;
  top: string;
  cssWidth: string;
  cssHeight: string;
  transform: string;
  opacity: string;
}

async function drawingSnapshot(drawing: Locator): Promise<DrawingSnapshot> {
  return drawing.evaluate((node) => {
    if (!(node instanceof SVGSVGElement)) throw new Error('Generated drawing is not native SVG.');
    const path = node.querySelector('path');
    const d = path?.getAttribute('d');
    const width = Number(node.getAttribute('width'));
    const height = Number(node.getAttribute('height'));
    if (!path || !d || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      throw new Error('Generated drawing has incomplete native geometry.');
    return {
      width, height, d,
      fill: path.getAttribute('fill'), stroke: path.getAttribute('stroke'),
      strokeWidth: path.getAttribute('stroke-width'), fillRule: path.getAttribute('fill-rule'),
      lineCap: path.getAttribute('stroke-linecap'), lineJoin: path.getAttribute('stroke-linejoin'),
      left: node.style.left, top: node.style.top,
      cssWidth: node.style.width, cssHeight: node.style.height,
      transform: node.style.transform, opacity: node.style.opacity,
    };
  });
}

// Main assigns IDs to new elements. Match the actual saved stroke's content,
// then use its authoritative ID without changing the production identity policy.
function storedDrawing(userData: string, presentationId: string, captured: DrawingSnapshot): { id: string; path: NativePath } {
  const rows = rawContent(userData, presentationId);
  const page = requiredAt(rows.slides, 0, 'first persisted PDF page');
  const matches = rows.elements.flatMap((row) => {
    if (row.slide_id !== page.id || row['kind'] !== 'shape') return [];
    const props = JSON.parse(String(row['props'])) as Record<string, unknown>;
    const parsed = slideElementSchema.safeParse({
      ...props, id: row['id'], kind: row['kind'],
      frame: { x: row['x'], y: row['y'], width: row['width'], height: row['height'] },
      rotation: row['rotation'],
    });
    if (!parsed.success || parsed.data.kind !== 'shape' || parsed.data.shape !== 'path') return [];
    const element = parsed.data;
    const path = element.path;
    if (!path || element.frame.width !== captured.width || element.frame.height !== captured.height ||
      nativePathData(path, element.frame.width, element.frame.height) !== captured.d ||
      (element.fill ?? 'none') !== captured.fill || (element.outline?.color ?? 'none') !== captured.stroke ||
      String(element.outline?.width ?? 0) !== captured.strokeWidth || path.fillRule !== captured.fillRule ||
      path.lineCap !== captured.lineCap || path.lineJoin !== captured.lineJoin) return [];
    return [{ id: element.id, path, kind: row['kind'], shape: element.shape }];
  });
  expect(matches, 'exactly one Main-owned drawing matches the native stroke path, size and paint').toHaveLength(1);
  const saved = requiredAt(matches, 0, 'persisted native drawing');
  expect(saved.kind).toBe('shape');
  expect(saved.shape).toBe('path');
  return { id: saved.id, path: saved.path };
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
    const captured = await drawingSnapshot(drawing);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    s.unchanged();

    const persisted = storedDrawing(s.userData, s.id, captured);
    expect(persisted.id, 'Main owns the persisted ID of a newly drawn element').not.toBe(id);
    const path = persisted.path;
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
    const reopenedDrawing = reopened.editor.getByTestId('editor-slide').locator(`[data-element="${persisted.id}"]`);
    await expect(reopenedDrawing).toHaveAttribute('data-shape', 'path');
    expect(await drawingSnapshot(reopenedDrawing), 'native path, geometry, transform and paint survive Save/reopen exactly').toEqual(captured);
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
