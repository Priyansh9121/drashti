import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expectNoSeriousA11yIssues } from './a11y';
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

async function start() {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-design-motion-')), 'Placeholder editor design.txt');
  writeFileSync(
    file,
    '[Placeholder group]\nPlaceholder first slide\n\nPlaceholder second slide\n\nPlaceholder third slide\n',
  );
  const [id = ''] = await importAndGetIds(win, [file]);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder editor design/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  return { app, win, ed, editor, id };
}

test('Design keeps a gradient, slide size and layout with Undo and Redo, saved and reopened', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Design');
    await expect(editor.getByTestId('design-background-kind')).toBeVisible();
    await editor.getByTestId('design-background-kind').selectOption('gradient');
    await editor.getByTestId('design-gradient-from').fill('#123456');
    await editor.getByTestId('design-gradient-to').fill('#654321');
    await editor.getByTestId('design-layout').selectOption('two-columns');
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(2);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(2);
    await editor.getByTestId('design-size').click();
    await ed.getByTestId('slide-size-preset').selectOption('standard');
    await ed.getByRole('button', { name: 'Keep size', exact: true }).click();
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await sizeSlideEditor(app, ed, size);
      await expectNoSeriousA11yIssues(ed, `Design ${size.width}`);
    }
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect([saved.doc.width, saved.doc.height]).toEqual([1440, 1080]);
    expect(saved.doc.groups[0]?.slides[0]).toMatchObject({
      design: { layout: 'two-columns', backdrop: { kind: 'gradient', from: '#123456', to: '#654321' } },
    });
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await editorGroup(reopened.ed, 'Design');
    await expect(reopened.editor.getByTestId('design-background-kind')).toHaveValue('gradient');
    await expect(reopened.editor.getByTestId('design-layout')).toHaveValue('two-columns');
  } finally {
    await app.close();
  }
});

test('Design edits one master on the canvas and keeps it behind the presentation’s own slides', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Design');
    await expect(editor.getByTestId('design-master')).toBeVisible();
    await editor.getByTestId('design-master').click();
    await expect(editor.getByTestId('editor-master-banner')).toBeVisible();
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-text').click();
    await editor.locator('[data-editing="true"] .ProseMirror').fill('Placeholder master heading');
    await editor.getByTestId('master-done').click();
    await expect(editor.getByTestId('editor-master-banner')).toHaveCount(0);
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder master heading');
    await editor.getByTestId('editor-slide-thumb').nth(1).click();
    await expect(editor.getByTestId('editor-slide')).toContainText('Placeholder master heading');
    await editorGroup(ed, 'Design');
    await editor.getByTestId('design-master').click();
    const canvas = await editor.getByTestId('editor-canvas').boundingBox();
    if (!canvas) throw new Error('no canvas');
    await ed.mouse.dblclick(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await editor.locator('[data-editing="true"] .ProseMirror').fill('Placeholder revised master');
    await editor.getByTestId('master-done').click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc).toMatchObject({
      master: { elements: [expect.objectContaining({ text: 'Placeholder revised master' })] },
    });
    expect(saved.doc.groups.flatMap((g) => g.slides)).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test('Motion keeps per-element in, emphasis and out times as well as the slide transition and auto advance', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editor.getByTestId('editor-canvas').focus();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editorGroup(ed, 'Motion');
    await expect(editor.getByTestId('motion-element-in')).toBeVisible();
    await editor.getByTestId('motion-element-in').selectOption('fade');
    await editor.getByTestId('motion-in-duration').fill('1');
    await editor.getByTestId('motion-element-emphasis').selectOption('pulse');
    await editor.getByTestId('motion-emphasis-delay').fill('1.5');
    await editor.getByTestId('motion-element-out').selectOption('fade');
    await editor.getByTestId('motion-out-delay').fill('4');
    await editor.getByTestId('motion-transition').selectOption('dissolve');
    await editor.getByTestId('motion-transition-seconds').fill('0.4');
    await editor.getByTestId('motion-auto').check();
    await editor.getByTestId('motion-auto-seconds').fill('6');
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]).toMatchObject({
      transition: { kind: 'dissolve', durationMs: 400 },
      autoAdvanceMs: 6000,
      elements: [
        expect.objectContaining({
          motion: {
            in: { kind: 'fade', durationMs: 1000 },
            emphasis: { kind: 'pulse', delayMs: 1500 },
            out: { kind: 'fade', delayMs: 4000 },
          },
        }),
      ],
    });
  } finally {
    await app.close();
  }
});

test('Slides offers a draggable strip and notes while a box is selected, with one Undo for its reorder', async () => {
  const { app, win, ed, editor, id } = await start();
  try {
    await editorGroup(ed, 'Slides');
    await expect(editor.getByTestId('slides-strip')).toBeVisible();
    await editor.getByTestId('slides-strip').check();
    await expect(editor.getByTestId('editor-slides')).toHaveAttribute('data-direction', 'across');
    const thumbs = editor.getByTestId('editor-slide-thumb');
    const original = await thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id')));
    const from = await thumbs.nth(0).boundingBox();
    const to = await thumbs.nth(2).boundingBox();
    if (!from || !to) throw new Error('no slide strip');
    await ed.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await ed.mouse.down();
    await ed.mouse.move(to.x + to.width - 3, to.y + to.height / 2, { steps: 16 });
    await ed.mouse.up();
    await expect
      .poll(() => thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id'))))
      .toEqual([original[1], original[2], original[0]]);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(() => thumbs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slide-id'))))
      .toEqual(original);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await editor.getByTestId('editor-canvas').focus();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.getByTestId('slides-notes').click();
    await ed.getByTestId('slides-notes-text').fill('Placeholder notes from the Slides group');
    await ed.getByRole('button', { name: 'Keep notes', exact: true }).click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      id,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides.at(-1)?.notes).toBe('Placeholder notes from the Slides group');
  } finally {
    await app.close();
  }
});
