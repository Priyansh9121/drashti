import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { canvasPixels, pixels } from './pixels';
import { makeSlides } from './placeholder-slides';
import { makeTestVideo } from './test-media';

/*
 * Darkening behind the words (Sessions 31–36, SLD-3): none unless chosen; a band behind the words or the
 * whole picture, 40, 60 or 80% dark, drawn over the background (a video too) and under the words; the
 * editor reads the words' contrast, darkening included, and Undo takes it back. Placeholder words and a
 * generated video only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** White words on a white slide: the contrast is 1:1. */
async function whiteOnWhite(win: Page): Promise<string> {
  const id = await makeSlides(
    win,
    'Placeholder white on white',
    [
      { words: 'Placeholder white words', wordsColor: '#ffffff', background: '#ffffff' },
      { words: 'Placeholder two' },
    ],
    { kind: 'cut', durationMs: 0 },
  );
  return id;
}

test('the editor warns of white words over white, darkening clears it, and Undo takes it back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  await whiteOnWhite(win);
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder white on white/u })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  const canvas = editor.getByTestId('editor-canvas');
  await expect(canvas).toBeVisible();
  const selectWords = async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(editor.getByTestId('inspector-text')).toBeVisible();
  };
  // Nothing darkens it: none is chosen on a slide to begin with.
  await expect(editor.getByTestId('slide-darken')).toHaveValue('none');
  await selectWords();
  const contrast = editor.getByTestId('inspector-contrast');
  await expect(contrast).toHaveAttribute('data-level', 'warning');
  await expect(contrast).toContainText('The words are 1.0:1 against what is behind them');
  // The slide's own settings: the whole picture, 80% dark.
  await win.keyboard.press('Escape');
  await editor.getByTestId('slide-darken').selectOption('whole');
  await editor.getByTestId('slide-darken-strength').selectOption('0.8');
  await expectNoSeriousA11yIssues(win, 'the slide’s darkening');
  await selectWords();
  await expect(contrast).toHaveAttribute('data-level', 'fine');
  // The slide in the editor draws it under the words.
  await expect(editor.locator('[data-testid="editor-slide"] [data-darken="whole"]')).toHaveCount(1);
  // Undo takes it back, one step at a time.
  await win.keyboard.press('Escape');
  await win.keyboard.press(`${mod}+z`);
  await expect(editor.getByTestId('slide-darken-strength')).toHaveValue('0.6');
  await win.keyboard.press(`${mod}+z`);
  await expect(editor.getByTestId('slide-darken')).toHaveValue('none');
  await expect(editor.locator('[data-testid="editor-slide"] [data-darken]')).toHaveCount(0);
  await app.close();
});

test('on the hall’s screen the whole picture darkens over a video and under the words; with none, nothing changes', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-darken-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder darken video.webm'), {
    seconds: 6,
    width: 320,
    height: 180,
    hue: 210,
  });
  const [videoId = ''] = await importAndGetIds(win, [video]);
  // Words over the slide's middle; the second slide the same, darkened.
  const id = await makeSlides(
    win,
    'Placeholder darken',
    [{ words: 'Placeholder words over a video' }, { words: 'Placeholder words over a video' }],
    { kind: 'cut', durationMs: 0 },
  );
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    const second = opened.doc.groups.flatMap((g) => g.slides)[1];
    if (second) second.darken = { kind: 'whole', strength: 0.8 };
    const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
    if (!saved.ok) throw new Error(saved.message);
  }, id);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  // The video behind the slides, as a background.
  await win.evaluate(
    (mediaId) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
      } as never),
    videoId,
  );
  const live = async (slideIndex: number) => {
    await win.evaluate(
      ({ id, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex,
        }),
      { id, slideIndex },
    );
  };
  // Along the bottom, away from the words and the video's own figures: its light, the median of three.
  const light = async () => {
    const points = [
      { x: 1500, y: 1010 },
      { x: 1700, y: 1010 },
      { x: 1880, y: 1010 },
    ];
    const sums = (await canvasPixels(out, points)).map((p) => (p[0] ?? 0) + (p[1] ?? 0) + (p[2] ?? 0));
    return [...sums].sort((a, b) => a - b)[1] ?? 0;
  };
  await live(0);
  const words = out.locator('[data-layer="slide"] [data-element]').first();
  await expect(words).toContainText('Placeholder words over a video');
  await expect(out.locator('[data-darken]')).toHaveCount(0);
  await expect.poll(light).toBeGreaterThan(150);
  const plain = await light();
  await live(1);
  // Drawn under the words: before them in the slide.
  const order = await out
    .locator('[data-layer="slide"] [data-slide]')
    .evaluate((slide) =>
      [...slide.children].map(
        (c) => (c as HTMLElement).dataset['darken'] ?? (c as HTMLElement).dataset['element'] ?? '',
      ),
    );
  expect(order.indexOf('whole')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('whole')).toBeLessThan(order.findIndex((e) => e !== '' && e !== 'whole'));
  // Over the video: its light is a fifth of what it was (80% dark), give or take the video's own change.
  await expect.poll(light).toBeLessThan(plain * 0.4);
  // The words stay white over it.
  const box = await words.boundingBox();
  if (!box) throw new Error('no words');
  const grid = Array.from({ length: 120 }, (_, i) => ({
    x: box.x + ((i % 30) + 0.5) * (box.width / 30),
    y: box.y + box.height / 2 + (Math.floor(i / 30) - 1.5) * 4,
  }));
  const brightest = Math.max(
    ...(await pixels(out, grid)).map((p) => Math.min(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)),
  );
  expect(brightest).toBeGreaterThan(230);
  await app.close();
});
