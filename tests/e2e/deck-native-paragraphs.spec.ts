import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDeck, placeholderDeckMedia } from '../../src/main/import/testing/make-deck';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { openEditor, sourceWord } from './deck-edit-fixtures';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
  slideEditorClosed,
} from './helpers';
import { holdClock } from './placeholder-slides';

/*
 * A PowerPoint text box built paragraph by paragraph, played by Drashti itself (no Office here): each paragraph,
 * its list mark with it, shows from its own click and never before, on the screens, while the box stays put.
 */

const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = async (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);

async function inStep(app: ElectronApplication, win: Page, step: number, elapsed: number) {
  await expect.poll(async () => (await current(win))?.step).toBe(step);
  const live = await current(win);
  expect(live?.stepAt).toBeDefined();
  await holdClock(app, (live?.stepAt ?? 0) + elapsed);
}

const POINTS = ['Placeholder first point', 'Placeholder second point', 'Placeholder third point'];

test('a paragraph build shows each paragraph from its own click on the screens, never before', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-paragraph-build-e2e-'));
  try {
    const file = join(dir, 'Placeholder paragraph build.pptx');
    await writeFile(
      file,
      makeTestDeck(
        [
          {
            key: 'placeholder-points',
            bg: '244060',
            transition: { kind: 'fade', dur: 200 },
            notes: '',
            shapes: [
              {
                id: 2,
                type: 'text',
                name: 'Placeholder points',
                x: 914_400,
                y: 914_400,
                w: 7_315_200,
                h: 3_657_600,
                paras: POINTS.map((text, i) => ({
                  text,
                  bullet: true,
                  ...(i === 1 ? { spaceBefore: 1200 } : {}),
                })),
              },
            ],
            effects: POINTS.map((_, para) => ({
              kind: 'fade' as const,
              target: 2,
              para,
              dur: 300,
              start: 'click' as const,
            })),
          },
        ],
        placeholderDeckMedia(),
      ),
    );
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
      const build = out.locator('[data-deck-paragraph-build="2"]');
      const words = (index: number) => build.locator('[data-run]', { hasText: POINTS[index] ?? '' });
      // Where the box draws its list marks, each shows and hides with the words on its line.
      const marksFollowWords = () =>
        build.evaluate((box) =>
          Array.from(box.querySelectorAll('[data-list-marker]')).every((mark) => {
            const line = mark.closest('[data-line]')?.querySelector('[data-run]');
            return !line || getComputedStyle(mark).opacity === getComputedStyle(line).opacity;
          }),
        );

      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await inStep(app, win, 0, 0);
      for (const index of [0, 1, 2]) await expect(words(index)).toHaveCSS('opacity', '0');
      await expect.poll(marksFollowWords).toBe(true);
      await expect(words(1).locator('..')).toHaveCSS('padding-block-start', '16px');

      await dispatch(win, { type: 'next' });
      await inStep(app, win, 1, 150);
      await expect(words(0)).toHaveCSS('opacity', '0.5');
      await expect(words(1)).toHaveCSS('opacity', '0');
      await inStep(app, win, 1, 300);
      await expect(words(0)).toHaveCSS('opacity', '1');
      await expect(words(1)).toHaveCSS('opacity', '0');
      await expect(words(2)).toHaveCSS('opacity', '0');
      await expect.poll(marksFollowWords).toBe(true);

      await dispatch(win, { type: 'next' });
      await inStep(app, win, 2, 300);
      await expect(words(0)).toHaveCSS('opacity', '1');
      await expect(words(1)).toHaveCSS('opacity', '1');
      await expect(words(1).locator('..')).toHaveCSS('padding-block-start', '16px');
      await expect(words(2)).toHaveCSS('opacity', '0');

      // Back settles the click before at once: the second paragraph is hidden again.
      await dispatch(win, { type: 'back' });
      await inStep(app, win, 1, 0);
      await expect(words(1)).toHaveCSS('opacity', '0');
      await expect(words(0)).toHaveCSS('opacity', '1');
      await holdClock(app, null);
      await dispatch(win, { type: 'clearLayer', layer: 'slide' });

      const addedPoint = 'Placeholder added point';
      const { ed, editor } = await openEditor(app, win, 'Placeholder paragraph build');
      await sourceWord(editor, POINTS[2] ?? '').dblclick();
      const typing = editor.getByTestId('text-editing');
      await expect(typing).toBeFocused();
      await typing.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
      await typing.press('Enter');
      await ed.keyboard.insertText(addedPoint);
      await expect(typing.getByText(addedPoint, { exact: true })).toBeVisible();
      await editor.getByTestId('save-slides').click();
      await slideEditorClosed(app);

      const added = build.locator('[data-run]', { hasText: addedPoint });
      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await inStep(app, win, 0, 0);
      await expect(added).toHaveCSS('opacity', '0');
      for (const step of [1, 2, 3]) {
        await dispatch(win, { type: 'next' });
        await inStep(app, win, step, 150);
        const opacity = step === 3 ? '0.5' : '0';
        await expect(words(2)).toHaveCSS('opacity', opacity);
        await expect(added).toHaveCSS('opacity', opacity);
      }
      await inStep(app, win, 3, 300);
      await expect(added).toHaveCSS('opacity', '1');
      await expect.poll(marksFollowWords).toBe(true);
      await holdClock(app, null);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
