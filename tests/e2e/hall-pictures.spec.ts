import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';
import { drawPicture, goLive, makeSlides, plain } from './placeholder-slides';

/*
 * The hall's screens wait for a slide's pictures, as the stream's page does (Session 59, X19; the owner's decision
 * Q58-52): a slide never shows there before its pictures can be drawn: not the slide it first draws, nor a jump to one
 * it has not loaded ahead. Every picture here comes 1.5 s late, as from a slow disk (DRASHTI_TEST_MEDIA_DELAY_MS). A
 * picture loaded ahead (Next's, by the screen's Preloader) adds no wait.
 */

const DELAY_MS = 1500;

interface HallFrame {
  /** When the screen drew it (its performance.now()). */
  t: number;
  /** The pictures shown on a slide while they could not be drawn yet (their addresses' last part), if any. */
  bad: string;
  /** A slide cut in that still waits for its pictures (what was up before stays). */
  waiting: boolean;
}

/** From now on, the hall screen keeps a line for every frame it draws. */
async function watchFrames(hall: Page): Promise<void> {
  await hall.evaluate(() => {
    const frames: { t: number; bad: string; waiting: boolean }[] = [];
    (globalThis as unknown as { drashtiTestHallFrames?: typeof frames }).drashtiTestHallFrames = frames;
    const tick = () => {
      const bad: string[] = [];
      for (const img of document.querySelectorAll<HTMLImageElement>(
        '[data-layer="slide"] [data-slide-in] img, [data-layer="slide"] [data-slide-out] img',
      )) {
        if (img.complete) continue;
        const slide = img.closest<HTMLElement>('[data-slide-in], [data-slide-out]');
        if (slide && getComputedStyle(slide).opacity !== '0') bad.push(img.src.split('/').pop() ?? '?');
      }
      frames.push({
        t: performance.now(),
        bad: bad.join(','),
        waiting:
          document.querySelector('[data-layer="slide"][data-fading="true"]:not([data-fade-start])') !== null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const hallNow = (hall: Page) => hall.evaluate(() => performance.now());
const framesSince = (hall: Page, from: number) =>
  hall.evaluate(
    (from) =>
      (
        (globalThis as unknown as { drashtiTestHallFrames?: HallFrame[] }).drashtiTestHallFrames ?? []
      ).filter((f) => f.t >= from),
    from,
  );

/** The hall screen shows slide n's words with its picture, whole. */
async function whole(hall: Page, words: string): Promise<void> {
  await expect(hall.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(hall.locator('[data-layer="slide"] [data-slide-in]')).toContainText(words);
  await expect
    .poll(() =>
      hall.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLImageElement>('[data-layer="slide"] [data-slide-in] img')).every(
          (img) => img.complete,
        ),
      ),
    )
    .toBe(true);
}

test('a hall screen never shows a slide before its pictures can be drawn: the first, and a jump to one not loaded ahead (X19)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_MEDIA_DELAY_MS: String(DELAY_MS),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-hall-pictures-'));
  const colours = ['32,64,96', '96,32,64', '64,96,32', '96,96,32', '32,96,96'];
  const files: string[] = [];
  for (const [n, rgb] of colours.entries())
    files.push(await drawPicture(win, join(dir, `Placeholder hall picture ${String(n)}.png`), plain(rgb)));
  const ids = await importAndGetIds(win, files);
  const words = ids.map((_, n) => `Placeholder hall words ${String(n)}`);
  const id = await makeSlides(
    win,
    'Placeholder hall pictures',
    ids.map((picture, n) => ({ picture, words: words[n] ?? '' })),
    { kind: 'cut', durationMs: 0 },
  );
  await setUpScreen(win);
  const hall = await outputPage(app);
  await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await watchFrames(hall);
  const lines: string[] = [];
  let shownBad = 0;
  const step = async (n: number, what: string) => {
    const from = await hallNow(hall);
    await goLive(win, id, n);
    await whole(hall, words[n] ?? '');
    const frames = await framesSince(hall, from);
    const bad = frames.filter((f) => f.bad !== '');
    shownBad += bad.length;
    lines.push(
      `${what}: ${String(frames.length)} frames, ${String(frames.filter((f) => f.waiting).length)} waiting, ` +
        `${String(bad.length)} with a picture not drawn${bad[0] ? ` (from ${String(Math.round(bad[0].t - from))} ms: ${bad[0].bad})` : ''}`,
    );
    return frames;
  };
  // The first slide, from nothing: its picture 1.5 s late.
  await step(0, 'the first slide');
  // A jump to a slide not loaded ahead (Next's is slide 1): its picture 1.5 s late too.
  await step(3, 'a jump to slide 3');
  expect(shownBad, `a slide shown before its pictures could be drawn: ${lines.join('; ')}`).toBe(0);

  // Next's picture loaded ahead (slide 4's): the cut to it waits for nothing.
  await expect(hall.locator(`[data-preload="${ids[4] ?? ''}"][data-state="ready"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  const ahead = await step(4, 'Next to slide 4, loaded ahead');
  expect(
    ahead.filter((f) => f.waiting).length,
    `a slide loaded ahead waited for its pictures: ${lines.join('; ')}`,
  ).toBe(0);
  expect(shownBad, lines.join('; ')).toBe(0);
  await app.close();
});
