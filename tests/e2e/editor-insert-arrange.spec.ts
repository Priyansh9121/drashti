import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { drawPicture, goLive, halves } from './placeholder-slides';
import { near, pixels } from './pixels';
import { makeTestTone, makeTestVideo } from './test-media';
import {
  editorGroup,
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
} from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Hold metadata until the test releases it, without a timing-dependent delay. */
async function holdPictureSize(ed: Page): Promise<void> {
  await ed.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error('no image decoder');
    const decode = descriptor.value as (this: HTMLImageElement) => Promise<void>;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    (globalThis as unknown as { releasePictureSize: () => void }).releasePictureSize = () => {
      HTMLImageElement.prototype.decode = decode;
      release();
    };
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      return gate.then(() => decode.call(this));
    };
  });
}

async function releasePictureSize(ed: Page): Promise<void> {
  await ed.evaluate(() => (globalThis as unknown as { releasePictureSize: () => void }).releasePictureSize());
}

async function start() {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-insert-arrange-')), 'Placeholder tools.txt');
  writeFileSync(file, 'Placeholder editable words\n');
  const [presentationId = ''] = await importAndGetIds(win, [file]);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder tools/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const { ed, editor } = await slideEditorWindow(app);
  return { app, win, ed, editor, presentationId };
}

test('Insert makes a table of editable cells, an arrow and an icon, each with one Undo and Redo', async () => {
  const { app, ed, editor } = await start();
  try {
    await editorGroup(ed, 'Insert');
    await expect(editor.getByTestId('add-table')).toBeVisible();
    await editor.getByTestId('add-table').click();
    await ed.getByTestId('table-rows').fill('2');
    await ed.getByTestId('table-columns').fill('3');
    await ed.getByRole('button', { name: 'Add table', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(13);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(13);
    await editor.getByTestId('add-shape').click();
    await ed.getByRole('menuitem', { name: 'Arrow', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-shape="arrow"]')).toHaveCount(1);
    await editor.getByTestId('add-icon').click();
    await ed.getByRole('menuitem', { name: 'Star', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-shape="star"]')).toHaveCount(1);
    await expect(editor.getByTestId('add-sound')).toBeVisible();
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await sizeSlideEditor(app, ed, size);
      await expectNoSeriousA11yIssues(ed, `Insert at ${size.width} by ${size.height}`);
    }
  } finally {
    await app.close();
  }
});

test('Insert keeps a cropped picture, a video and a sound on this slide across saving and reopening', async () => {
  const { app, win, ed, editor, presentationId } = await start();
  try {
    await setUpScreen(win);
    const output = await outputPage(app);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-insert-media-'));
    const picture = await drawPicture(
      win,
      join(dir, 'Placeholder crop.png'),
      halves('240,20,20', '20,220,20'),
    );
    const video = await makeTestVideo(win, join(dir, 'Placeholder insert.webm'), { seconds: 2, hue: 120 });
    const tone = makeTestTone(join(dir, 'Placeholder insert.wav'), { seconds: 2 });
    const [pictureId = '', videoId = '', soundId = ''] = await importAndGetIds(win, [picture, video, tone]);
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-media').click();
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Picture: Placeholder crop/ })
      .click();
    await expect(editor.getByTestId('crop-picture')).toBeEnabled();
    await editor.getByTestId('crop-picture').click();
    await ed.getByTestId('crop-right').fill('50');
    await ed.getByRole('button', { name: 'Keep crop', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-crop]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-crop]')).toHaveCount(0);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-slide-crop]')).toHaveCount(1);
    // Keep the cropped picture clear of the video that is added next.
    await editor.getByTestId('field-x').fill('0');
    await editor.getByTestId('field-y').fill('0');
    await editor.getByTestId('add-media').click();
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Video: Placeholder insert/ })
      .click();
    await expect(editor.getByTestId('editor-status')).toContainText('Video selected');
    await editor.getByTestId('add-sound').click();
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Sound: Placeholder insert/ })
      .click();
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      presentationId,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.message);
    const slide = saved.doc.groups[0]?.slides[0];
    expect(slide?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          mediaId: pictureId,
          crop: { x: 0, y: 0, width: 0.5, height: 1 },
        }),
        expect.objectContaining({ kind: 'video', mediaId: videoId }),
      ]),
    );
    expect(slide?.cues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'audio', mediaId: soundId })]),
    );
    await goLive(win, presentationId, 0);
    const crop = output.locator('[data-slide-crop]');
    await expect(crop).toHaveCount(1);
    // Both sides of the kept half are red: the green half is actually cropped on the audience output.
    await expect
      .poll(async () => {
        const box = await crop.boundingBox();
        if (!box) return false;
        const colours = await pixels(
          output,
          [0.25, 0.75].map((part) => ({ x: box.x + box.width * part, y: box.y + box.height / 2 })),
        );
        return colours.every((colour) => near(colour, [240, 20, 20], 15));
      })
      .toBe(true);
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByRole('button', { name: /^Placeholder tools/ })
      .click();
    await win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(app);
    await expect(reopened.editor.getByTestId('editor-slide').locator('[data-slide-crop]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('Insert can make a timer and put it on the current slide, with Undo and Redo', async () => {
  const { app, ed, editor } = await start();
  try {
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-timer').click();
    await expect(ed.getByRole('menuitem', { name: 'New timer…', exact: true })).toBeVisible();
    await ed.getByRole('menuitem', { name: 'New timer…', exact: true }).click();
    const form = ed.getByTestId('new-editor-timer').getByTestId('timer-form');
    await form.getByRole('textbox', { name: 'Timer name', exact: true }).fill('Placeholder Insert Timer');
    await form.getByRole('textbox', { name: 'Length', exact: true }).fill('0:45');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-timer-element]')).toHaveAttribute(
      'data-time',
      '0:45',
    );
    await expect(editor.getByTestId('editor-slide-thumb')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-timer-element]')).toHaveCount(0);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(editor.getByTestId('editor-slide').locator('[data-timer-element]')).toHaveAttribute(
      'data-time',
      '0:45',
    );
  } finally {
    await app.close();
  }
});

test('Arrange groups elements, turns and flips them with Undo, and offers snapping, guides, rulers and a grid', async () => {
  const { app, ed, editor } = await start();
  try {
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-shape').click();
    await ed.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
    await editor.getByTestId('editor-canvas').focus();
    await ed.keyboard.press(`${mod}+A`);
    await editorGroup(ed, 'Arrange');
    await expect(editor.getByTestId('arrange-group-elements')).toBeEnabled();
    await editor.getByTestId('arrange-group-elements').click();
    await expect(editor.getByTestId('arrange-ungroup')).toBeEnabled();
    await editor.getByTestId('arrange-turn-right').click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]').first()).toHaveCSS(
      'transform',
      /matrix\(0, 1, -1, 0/,
    );
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await editor.getByTestId('arrange-flip-x').click();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]').first()).toHaveCSS(
      'transform',
      /matrix\(-1, 0, 0, 1/,
    );
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await editor.getByTestId('arrange-rulers').check();
    await editor.getByTestId('arrange-grid').check();
    await expect(editor.getByTestId('editor-rulers')).toBeVisible();
    await expect(editor.getByTestId('editor-grid')).toBeVisible();
    await editor.getByTestId('arrange-snap').uncheck();
    await editor.getByTestId('arrange-snap').check();
    await editor.getByTestId('arrange-guides').check();
    await expect(editor.getByTestId('editor-guides')).toBeVisible();
    await editor.getByTestId('arrange-ungroup').click();
    await expect(editor.getByTestId('arrange-ungroup')).toBeDisabled();
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await sizeSlideEditor(app, ed, size);
      await expectNoSeriousA11yIssues(ed, `Arrange at ${size.width} by ${size.height}`);
    }
  } finally {
    await app.close();
  }
});

test('a table cell stays editable inside its group; leaving typing selects the group, copies stay separate, and Shift-click lets it go', async () => {
  const { app, win, ed, editor, presentationId } = await start();
  try {
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-table').click();
    await ed.getByTestId('table-rows').fill('2');
    await ed.getByTestId('table-columns').fill('2');
    await ed.getByRole('button', { name: 'Add table', exact: true }).click();
    const canvas = editor.getByTestId('editor-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    await ed.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.35);
    const typing = editor.locator('[data-editing="true"] .ProseMirror');
    await expect(typing).toBeVisible();
    await typing.fill('Placeholder table cell');
    await ed.keyboard.press('Escape');
    await expect(editor.getByTestId('editor-status')).toHaveText('8 elements selected');
    await canvas.focus();
    await ed.keyboard.press(`${mod}+D`);
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(17);
    await expect(editor.getByTestId('editor-status')).toHaveText('8 elements selected');
    const scale = Number(await canvas.getAttribute('data-scale'));
    // Inside the cell's left border, away from the group's resize handles.
    const grab = { x: box.x + box.width * 0.1 + 4 * scale, y: box.y + box.height * 0.35 };
    await ed.mouse.click(grab.x, grab.y);
    await expect(editor.getByTestId('editor-status')).toHaveText('8 elements selected');
    const originalGroup = await editor.getByTestId('group-box').boundingBox();
    expect(Math.abs((originalGroup?.x ?? -999) - (box.x + box.width * 0.1))).toBeLessThan(2);
    await ed.keyboard.down('Shift');
    await ed.mouse.click(grab.x, grab.y);
    await ed.keyboard.up('Shift');
    await expect(editor.getByTestId('editor-status')).toHaveText('Nothing selected');
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      presentationId,
    );
    if (!saved.ok) throw new Error(saved.message);
    const cells = saved.doc.groups[0]?.slides[0]?.elements.filter((el) => el.groupId) ?? [];
    expect(cells).toHaveLength(16);
    expect(new Set(cells.map((el) => el.groupId)).size).toBe(2);
    expect(cells.filter((el) => el.kind === 'text' && el.text === 'Placeholder table cell')).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test('a guide can be moved on the canvas with one Undo, and is saved with its slide', async () => {
  const { app, win, ed, editor, presentationId } = await start();
  try {
    await editorGroup(ed, 'Arrange');
    await editor.getByTestId('arrange-guides').check();
    await editor.getByRole('button', { name: 'Place guides…', exact: true }).click();
    await ed.getByRole('spinbutton', { name: 'Across guide 1', exact: true }).fill('400');
    await ed.getByTestId('editor-guide-settings').getByRole('button', { name: 'Done', exact: true }).click();
    const guides = editor.getByTestId('editor-guides');
    const before = await guides.locator('[data-x="400"]').boundingBox();
    const canvas = editor.getByTestId('editor-canvas');
    const box = await canvas.boundingBox();
    if (!before || !box) throw new Error('no guide or canvas');
    const scale = Number(await canvas.getAttribute('data-scale'));
    const x = before.x + before.width / 2;
    const y = box.y + box.height * 0.1;
    await ed.mouse.move(x, y);
    await ed.mouse.down();
    await ed.mouse.move(x + 100 * scale, y, { steps: 8 });
    await ed.mouse.up();
    await expect(guides.locator('[data-x="500"]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(guides.locator('[data-x="400"]')).toHaveCount(1);
    await ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(guides.locator('[data-x="500"]')).toHaveCount(1);
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      presentationId,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]?.guides?.x).toEqual([500]);
  } finally {
    await app.close();
  }
});

test('Save while a picture’s size is being read waits for the picture and keeps it', async () => {
  const { app, win, ed, editor, presentationId } = await start();
  try {
    const file = await drawPicture(
      win,
      join(mkdtempSync(join(tmpdir(), 'drashti-pending-picture-')), 'Placeholder pending.png'),
      halves('240,20,20', '20,220,20'),
    );
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-media').click();
    await holdPictureSize(ed);
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Picture: Placeholder pending/ })
      .click();
    await ed.keyboard.press(`${mod}+S`);
    await expect(ed.getByTestId('media-picker-busy')).toBeVisible();
    await expect(editor.getByTestId('save-slides')).toBeDisabled();
    await releasePictureSize(ed);
    await slideEditorClosed(app);
    const saved = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      presentationId,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.doc.groups[0]?.slides[0]?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ mediaId, kind: 'image' })]),
    );
  } finally {
    await app.close();
  }
});

test('a picture whose size is pending goes onto the slide it was chosen for when another slide is requested', async () => {
  const initial = await start();
  const { app, win, presentationId } = initial;
  try {
    await editorGroup(initial.ed, 'Slides');
    await initial.editor.getByTestId('slide-new').click();
    await initial.editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);
    const before = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.library.slidesForEdit(id),
      presentationId,
    );
    if (!before.ok) throw new Error(before.message);
    const secondId = before.doc.groups[0]?.slides[1]?.id;
    if (!secondId) throw new Error('no second slide');
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    const file = await drawPicture(
      win,
      join(mkdtempSync(join(tmpdir(), 'drashti-picture-slide-')), 'Placeholder original slide.png'),
      halves('240,20,20', '20,220,20'),
    );
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    await editorGroup(ed, 'Insert');
    await editor.getByTestId('add-media').click();
    await holdPictureSize(ed);
    await ed
      .getByTestId('media-picker')
      .getByRole('button', { name: /^Picture: Placeholder original slide/ })
      .click();
    await win.evaluate(({ id, slide }) => (globalThis as PageGlobals).drashti.slideEditor.open(id, slide), {
      id: presentationId,
      slide: secondId,
    });
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(0);
    await releasePictureSize(ed);
    await expect(editor.locator(`[data-element][data-media-id="${mediaId}"]`).first()).toBeAttached();
    await expect(editor.getByTestId('editor-slide').locator('[data-element]')).toHaveCount(0);
    await editor.getByTestId('editor-slide-thumb').first().click();
    await expect(editor.getByTestId('editor-slide').locator(`[data-media-id="${mediaId}"]`)).toHaveCount(1);
  } finally {
    await app.close();
  }
});
