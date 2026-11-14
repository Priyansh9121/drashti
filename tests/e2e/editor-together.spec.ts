import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  onEditorSlide,
  openLibrary,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';

/*
 * The slide editor (Session 11): several elements selected (Select all, or
 * Shift-click) resize and turn together from the box round them, each
 * gesture one Undo; elements are copied and pasted between slides (Paste puts
 * them where they were; Paste in place even where that is taken) and between
 * presentations, keeping their styles, languages and media. Placeholder
 * words and generated shapes only. Since Session 55 (Part 17a) the editor has a window of its own, made for each
 * presentation edited: what is copied in one pastes in the next.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Drag in small steps between two points of the window. */
async function drag(win: Page, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  await win.mouse.move(a.x, a.y);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) await win.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await win.mouse.up();
}

/** Each element on the slide being edited: its place and size (slide pixels) and its turn. */
const elementsOf = (win: Page) =>
  win.getByTestId('editor-slide').evaluate((slide) =>
    [...slide.querySelectorAll<HTMLElement>(':scope > [data-element]')].map((el) => ({
      id: el.dataset['element'] ?? '',
      left: Math.round(parseFloat(el.style.left)),
      top: Math.round(parseFloat(el.style.top)),
      width: Math.round(parseFloat(el.style.width)),
      height: Math.round(parseFloat(el.style.height)),
      turn: /rotate\(([-\d.]+)deg\)/u.exec(el.style.transform)?.[1] ?? '0',
    })),
  );

test('several elements resize and turn together, each change one Undo; copy and paste between slides and presentations', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-together-'));
  const file = join(dir, 'Placeholder Together.txt');
  writeFileSync(file, '[Verse]\nનમૂના પંક્તિ\nNamūnā pankti\n\n[Chorus]\nPlaceholder chorus\n');
  const [presentationId = ''] = await importAndGetIds(win, [file]);

  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Together/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  await sizeSlideEditor(app, ed, { width: 1600, height: 900 });
  const status = editor.getByTestId('editor-status');
  // A rectangle beside the words.
  await editorGroup(ed, 'Insert');
  await editor.getByTestId('add-shape').click();
  await ed.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
  await expect(status).toContainText('Rectangle selected');
  const before = await elementsOf(ed);
  expect(before).toHaveLength(2);

  // Both selected (Select all): one box round them, with its own handles.
  await editor.getByTestId('editor-canvas').focus();
  await ed.keyboard.press(`${mod}+A`);
  await expect(status).toHaveText('2 elements selected');
  await expect(editor.getByTestId('group-box')).toBeVisible();
  await expectNoSeriousA11yIssues(ed, 'the slide editor with two elements selected');

  // Moved together: drag one of them 150 px down (Alt: no snapping); both move, and one Undo puts both back.
  const first = before[0];
  if (!first) throw new Error('no element');
  const grab = await onEditorSlide(ed, first.left + 30, first.top + 30);
  const dropAt = await onEditorSlide(ed, first.left + 30, first.top + 180);
  await ed.keyboard.down('Alt');
  await drag(ed, grab, dropAt);
  await ed.keyboard.up('Alt');
  // Both by the same amount, about 150 px (the pointer lands on whole screen pixels).
  await expect
    .poll(async () => {
      const moved = (await elementsOf(ed)).map((x) => x.top - (before.find((b) => b.id === x.id)?.top ?? 0));
      const [a = 0, b = 0] = moved;
      return moved.length === 2 && Math.abs(a - b) <= 1 && Math.abs(a - 150) <= 3;
    })
    .toBe(true);
  await expect(status).toHaveText('2 elements selected');
  await ed.keyboard.press(`${mod}+Z`);
  await expect.poll(() => elementsOf(ed)).toEqual(before);

  // Resize together from the right edge, 200 px to the left: both get narrower, the left edge stays.
  const e = await editor.getByTestId('group-handle-e').boundingBox();
  if (!e) throw new Error('no handle');
  const scale = Number(await editor.getByTestId('editor-canvas').getAttribute('data-scale'));
  await drag(
    ed,
    { x: e.x + e.width / 2, y: e.y + e.height / 2 },
    { x: e.x + e.width / 2 - 200 * scale, y: e.y + e.height / 2 },
  );
  const resized = await elementsOf(ed);
  expect(resized.map((r) => r.width < (before.find((b) => b.id === r.id)?.width ?? 0))).toEqual([true, true]);
  // One Undo puts both back.
  await ed.keyboard.press(`${mod}+Z`);
  await expect.poll(() => elementsOf(ed)).toEqual(before);

  // Turn together from the round handle: a quarter turn (Shift holds it to steps of 15 degrees).
  const turnHandle = await editor.getByTestId('group-handle-rotate').boundingBox();
  const box = await editor.getByTestId('group-box').boundingBox();
  if (!turnHandle || !box) throw new Error('no box');
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const r = c.y - (turnHandle.y + turnHandle.height / 2);
  await ed.keyboard.down('Shift');
  await ed.mouse.move(c.x, c.y - r);
  await ed.mouse.down();
  for (let i = 1; i <= 9; i++) {
    const a = (-90 + i * 10) * (Math.PI / 180);
    await ed.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  await ed.mouse.up();
  await ed.keyboard.up('Shift');
  await expect.poll(async () => (await elementsOf(ed)).map((x) => x.turn)).toEqual(['90', '90']);
  await ed.keyboard.press(`${mod}+Z`);
  await expect.poll(() => elementsOf(ed)).toEqual(before);

  // Copy the rectangle, paste it on the second slide (where it was), and in place on this one.
  const rect = before[1];
  if (!rect) throw new Error('no rectangle');
  const p = await onEditorSlide(ed, rect.left + rect.width / 2, rect.top + rect.height / 2);
  await ed.mouse.click(p.x, p.y);
  await expect(status).toContainText('Rectangle selected');
  await ed.keyboard.press(`${mod}+C`);
  await expect(editor.getByTestId('editor-note')).toContainText('Copied 1 element.');
  await ed.keyboard.press(`${mod}+Shift+V`);
  await expect.poll(async () => (await elementsOf(ed)).length).toBe(3);
  const inPlace = await elementsOf(ed);
  expect(inPlace[2]).toMatchObject({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  });
  await editor.getByTestId('editor-slide-thumb').nth(1).click();
  const second = (await elementsOf(ed)).length;
  await editor.getByTestId('editor-canvas').focus();
  await ed.keyboard.press(`${mod}+V`);
  await expect.poll(async () => (await elementsOf(ed)).length).toBe(second + 1);
  expect((await elementsOf(ed)).at(-1)).toMatchObject({ left: rect.left, top: rect.top });
  // And the words (Gujarati and transliteration in their own styles) from the first slide.
  await editor.getByTestId('editor-slide-thumb').nth(0).click();
  const words = before[0];
  if (!words) throw new Error('no words');
  const w = await onEditorSlide(ed, words.left + 20, words.top + 20);
  await ed.mouse.click(w.x, w.y);
  await expect(status).toContainText('Text box');
  await ed.keyboard.press(`${mod}+C`);
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);

  // Into another presentation (the sample kirtan), in the window made for it: the same words, languages and look.
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
    .click();
  const sampleId = (await win.getByTestId('slide-grid').getAttribute('data-presentation-id')) ?? '';
  await win.getByTestId('edit-slides').click();
  const next = await slideEditorWindow(app);
  await sizeSlideEditor(app, next.ed, { width: 1600, height: 900 });
  const had = (await elementsOf(next.ed)).length;
  await next.editor.getByTestId('editor-canvas').focus();
  await next.ed.keyboard.press(`${mod}+V`);
  await expect.poll(async () => (await elementsOf(next.ed)).length).toBe(had + 1);
  await next.editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  const docs = await win.evaluate(
    async ({ from, to }) => {
      const d = (globalThis as PageGlobals).drashti;
      const a = await d.library.slidesForEdit(from);
      const b = await d.library.slidesForEdit(to);
      if (!a.ok || !b.ok) throw new Error('cannot read');
      return {
        original: a.doc.groups[0]?.slides[0]?.elements.find((el) => el.kind === 'text') ?? null,
        pasted: b.doc.groups[0]?.slides[0]?.elements.at(-1) ?? null,
        slides: a.doc.groups.flatMap((g) => g.slides.map((s) => s.elements.map((el) => el.kind))),
      };
    },
    { from: presentationId, to: sampleId },
  );
  // Saved: the rectangle on both slides (and its copy in place on the first).
  expect(docs.slides).toEqual([
    ['text', 'shape', 'shape'],
    ['text', 'shape'],
  ]);
  const { id: _a, ...original } = docs.original ?? { id: '' };
  const { id: _b, ...pasted } = docs.pasted ?? { id: '' };
  expect(pasted).toEqual(original);
  expect(original).toMatchObject({ kind: 'text' });
  await app.close();
});
