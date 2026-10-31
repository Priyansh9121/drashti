import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { drawPicture, halves } from './placeholder-slides';
import { makeTestTone, makeTestVideo } from './test-media';
import {
  editorGroup,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

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
