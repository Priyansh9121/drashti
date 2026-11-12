import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeDeckFixture } from '../../src/main/import/deck/native-deck-fixture';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { openEditor, publicSlides, sourceWord } from './deck-edit-fixtures';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
  sizeSlideEditor,
  slideEditorClosed,
} from './helpers';
import { holdClock } from './placeholder-slides';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = async (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);
const motionTarget = (out: Page, id: number) => out.locator(`[data-deck-motion-target="${id}"]`);

async function inStep(app: ElectronApplication, win: Page, step: number, elapsed: number) {
  await expect.poll(async () => (await current(win))?.step).toBe(step);
  const live = await current(win);
  expect(live?.stepAt).toBeDefined();
  await holdClock(app, (live?.stepAt ?? 0) + elapsed);
}

test('PowerPoint clicks play on the screen without Office and survive a text edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-native-deck-e2e-'));
  try {
    const name = 'Placeholder native motion';
    const file = join(dir, `${name}.pptx`);
    await writeFile(file, nativeDeckFixture());
    const { app } = await launchApp({
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_TEST_CLOCK_HOLD: '1',
      DRASHTI_TEST_DECK_CONVERTER: '1',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [file]);
      expect(id).not.toBe('');
      await setUpScreen(win, 'Main Hall', 0);
      const out = await outputPage(app);
      await outputReady(out);

      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await inStep(app, win, 0, 170);
      await expect(motionTarget(out, 6)).toHaveCSS('opacity', '0.5');
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '0');

      await dispatch(win, { type: 'next' });
      await inStep(app, win, 1, 280);
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '1');
      await expect(motionTarget(out, 3)).not.toHaveCSS('transform', 'none');
      await expect(motionTarget(out, 4)).toHaveCSS('opacity', '0');

      await dispatch(win, { type: 'next' });
      await inStep(app, win, 2, 180);
      await expect(motionTarget(out, 4)).not.toHaveCSS('clip-path', 'none');
      await expect(motionTarget(out, 5)).toHaveCSS('opacity', '0');
      await inStep(app, win, 2, 495);
      await expect(motionTarget(out, 4)).toHaveCSS('clip-path', 'none');
      await expect(motionTarget(out, 5)).not.toHaveCSS('transform', 'none');

      await dispatch(win, { type: 'next' });
      await inStep(app, win, 3, 130);
      await expect(motionTarget(out, 5)).not.toHaveCSS('transform', 'none');
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '0.5');
      await dispatch(win, { type: 'back' });
      await inStep(app, win, 2, 0);
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '1');
      await expect(motionTarget(out, 5)).toHaveCSS('transform', 'none');

      await dispatch(win, { type: 'next' });
      await dispatch(win, { type: 'next' });
      await expect.poll(async () => (await current(win))?.slideIndex).toBe(1);
      const next = await current(win);
      expect(next?.transition).toMatchObject({ kind: 'wipe', durationMs: 650, direction: 'up' });
      const incoming = out.locator('[data-layer="slide"] [data-slide-in]').last();
      await holdClock(app, (next?.shownAt ?? 0) + 325);
      await expect(out.locator('[data-layer="slide"]')).toHaveAttribute('data-transition', 'wipe');
      await expect(incoming).not.toHaveCSS('clip-path', 'none');
      await holdClock(app, (next?.shownAt ?? 0) + 650);
      await expect(out.locator('[data-layer="slide"]')).not.toHaveAttribute('data-fading', 'true');
      await holdClock(app, null);

      const { ed, editor } = await openEditor(app, win, name);
      await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
      const word = sourceWord(editor, 'Placeholder appear');
      await word.dblclick();
      const typing = editor.getByTestId('text-editing');
      await expect(typing).toBeFocused();
      await typing.press(`${mod}+A`);
      await ed.keyboard.insertText('Placeholder edited appearance');
      await editor.getByTestId('save-slides').click();
      await slideEditorClosed(app);
      const saved = await publicSlides(win, id);
      expect(saved[0]?.slide.deck).toMatchObject({
        steps: [],
        motion: { approximate: false, stepsMs: [260, 480, 620, 300] },
      });
      expect(saved[0]?.slide.elements).toContainEqual(
        expect.objectContaining({ kind: 'text', text: 'Placeholder edited appearance', sourceShapeId: '2' }),
      );
      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await inStep(app, win, 0, 260);
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '0');
      await dispatch(win, { type: 'next' });
      await inStep(app, win, 1, 480);
      await expect(motionTarget(out, 2)).toHaveCSS('opacity', '1');
      await expect(motionTarget(out, 2)).toHaveText('Placeholder edited appearance');
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unsupported PowerPoint transition keeps its clip until the edited slide is saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-deck-fallback-e2e-'));
  try {
    const name = 'Placeholder deck fallback';
    const file = join(dir, `${name}.pptx`);
    await writeFile(file, nativeDeckFixture(true));
    const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1', DRASHTI_TEST_DECK_BAKER: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [file]);
      expect(id).not.toBe('');
      const before = await publicSlides(win, id);
      expect(before[0]?.slide.deck?.steps).toEqual([]);
      expect(before[1]?.slide.deck?.steps).toHaveLength(1);
      expect(before[1]?.slide.deck?.motion?.approximate).toBe(true);

      const { ed, editor } = await openEditor(app, win, name);
      await editor.getByTestId('editor-slide-thumb').nth(1).click();
      await sourceWord(editor, 'Placeholder next slide').dblclick();
      const warning = ed.getByTestId('source-conversion');
      await expect(warning).toContainText('closest effects');
      await warning.getByRole('button', { name: 'Make this slide editable' }).click();
      const typing = editor.getByTestId('text-editing');
      await expect(typing).toBeFocused();
      await typing.press(`${mod}+A`);
      await ed.keyboard.insertText('Placeholder edited slide');
      expect((await publicSlides(win, id))[1]?.slide.deck).toEqual(before[1]?.slide.deck);
      await editor.getByTestId('save-slides').click();
      await slideEditorClosed(app);

      const saved = await publicSlides(win, id);
      expect(saved[0]?.slide.deck).toEqual(before[0]?.slide.deck);
      expect(saved[1]?.slide.deck).toMatchObject({
        steps: [],
        motion: { approximate: true },
        transition: { nativeTransition: { deckEffect: 'dissolve', durationMs: 650 } },
      });
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
