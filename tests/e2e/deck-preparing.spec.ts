import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDeckMedia, makeTestDeck } from '../../src/main/import/testing/make-deck';
import { placeholderSlides } from '../../src/main/import/testing/timing-placeholders';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropFiles, launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A deck's slides shown as soon as their pictures are drawn (Session 56): its slides with animations are marked
 * "Preparing" on their rows (and its presentation's row) while their clips are made, and Next waits on such a slide,
 * saying so, until they are in. CI has no Office: the stand-in makes the movie (DRASHTI_TEST_DECK_BAKER), held until the
 * test lets it go (DRASHTI_TEST_DECK_BAKER_HOLD, which a packaged Drashti ignores). The deck: six placeholder slides, a
 * transition and three clicks, plain, plain, two clicks, plain, plain. In CI's window, 1024 × 645, with axe.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const DECK = 'Placeholder preparing deck';

test('a deck’s slides show at once, those with animations marked Preparing; Next waits on one, saying so, and goes on once its clips are in', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-e2e-preparing-'));
  const deck = join(dir, `${DECK}.pptx`);
  writeFileSync(deck, makeTestDeck(placeholderSlides(6), makeDeckMedia(ffmpeg ?? '', join(dir, 'made'))));
  const hold = join(dir, 'let the movie be made');
  const { app } = await launchApp({
    DRASHTI_TEST_DECK_BAKER: '1',
    DRASHTI_TEST_DECK_CONVERTER: '1',
    DRASHTI_TEST_DECK_BAKER_HOLD: hold,
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('library-drop'), [deck]);

  // Its slides are there while its movie is held: the two with animations marked Preparing.
  const row = win.getByTestId('presentation-list').getByTestId('presentation-row').filter({ hasText: DECK });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(6);
  const marks = win.getByTestId('slide-preparing');
  await expect(marks).toHaveCount(2);
  await expect(thumbs.nth(0).getByTestId('slide-preparing')).toBeVisible();
  await expect(thumbs.nth(3).getByTestId('slide-preparing')).toBeVisible();
  await expect(thumbs.nth(3)).toHaveAccessibleName(/its animations still being prepared/u);
  await expectNoSeriousA11yIssues(win, 'a deck’s slides, two of them preparing');

  // Next from the slide before one still preparing waits, saying so.
  const id = await win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    return (await d.library.listPresentations()).find((p) => p.name === name)?.id ?? '';
  }, DECK);
  await win.evaluate(async (presentationId) => {
    await (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 2 });
  }, id);
  const liveIndex = () =>
    win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.slideIndex);
  await expect.poll(liveIndex).toBe(2);
  await win.getByRole('button', { name: /^Next/u }).click();
  await expect(win.getByTestId('operator-notice')).toContainText(
    'Slide 4 is still being prepared: its animations are being made. Press Next again once it is ready.',
  );
  expect(await liveIndex()).toBe(2);

  // Its clips in: the marks go, and Next goes on to it.
  writeFileSync(hold, 'placeholder');
  await expect(marks).toHaveCount(0, { timeout: 120_000 });
  await win.getByRole('button', { name: /^Next/u }).click();
  await expect.poll(liveIndex).toBe(3);
  await app.close();
});
