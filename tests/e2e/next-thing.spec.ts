import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * The next thing to do (Session 26g): in a show, Next under LIVE is the one primary on the screen,
 * with its key, Back beside it, and no picture of what comes next; Clear all is a strong secondary
 * in its old place with its old key, and Put it back takes that place. Next and Back by mouse do
 * exactly what their keys do, at once. Placeholder content only.
 */

const live = (win: Page) =>
  win.evaluate(async () => {
    const { state } = await (globalThis as PageGlobals).drashti.engine.snapshot();
    return { presentation: state.live.presentationId, slide: state.live.slideIndex };
  });

/** The enabled primary buttons in the window, outside dialogs, by their words. */
const primaries = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-variant="primary"]')]
      .filter((b) => !b.disabled && b.offsetParent !== null && !b.closest('[aria-modal="true"]'))
      .map((b) => b.textContent.replace(/\s+/gu, ' ').trim()),
  );

test('in a show, Next under LIVE is the one primary, with its key; Back beside it; no picture of what comes next', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const next = win.getByTestId('show-next');
  const back = win.getByTestId('show-back');
  await expect(next).toBeVisible();
  await expect(next).toContainText('Next');
  await expect(next.locator('kbd')).toHaveText('→');
  await expect(back.locator('kbd')).toHaveText('←');
  // Under LIVE, Back on the left.
  const [nextBox, backBox, liveBox] = await Promise.all([
    next.boundingBox(),
    back.boundingBox(),
    win.getByTestId('live-preview').boundingBox(),
  ]);
  expect(nextBox && liveBox && nextBox.y > liveBox.y + liveBox.height - 1).toBe(true);
  expect(backBox && nextBox && backBox.x < nextBox.x).toBe(true);
  // A presentation is shown, nothing live yet: Next starts it, and is the one primary.
  await expect(back).toBeDisabled();
  expect(await primaries(win)).toEqual(['Next→']);
  await expect(win.getByTestId('next-preview')).toHaveCount(0);

  // Next and Back by mouse do what the keys do.
  await next.click();
  await expect.poll(() => live(win)).toMatchObject({ slide: 0 });
  const presentation = (await live(win)).presentation;
  await next.click();
  await expect.poll(() => live(win)).toEqual({ presentation, slide: 1 });
  await back.click();
  await expect.poll(() => live(win)).toEqual({ presentation, slide: 0 });
  await win.keyboard.press('ArrowRight');
  await expect.poll(() => live(win)).toEqual({ presentation, slide: 1 });
  await win.keyboard.press('ArrowLeft');
  await expect.poll(() => live(win)).toEqual({ presentation, slide: 0 });
  expect(await primaries(win)).toEqual(['Next→']);
  await expectNoSeriousA11yIssues(win, 'the window in a show');

  // Clear all: a strong secondary, where it was, with its key; Put it back takes its place.
  const clearAll = win.getByRole('button', { name: /^Clear all/u });
  await expect(clearAll).toHaveAttribute('data-variant', 'strong');
  await expect(clearAll.locator('kbd')).toHaveText('F1');
  const clearBox = await clearAll.boundingBox();
  await clearAll.click();
  const putBack = win.getByTestId('put-back');
  await expect(putBack).toHaveAttribute('data-variant', 'warning');
  expect((await putBack.boundingBox())?.x).toBe(clearBox?.x);
  await putBack.click();
  await expect.poll(() => live(win)).toEqual({ presentation, slide: 0 });
  await app.close();
});

test('Next goes quiet at the end of the show: no primary pretends there is something next', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const last = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    await d.engine.dispatch({
      type: 'goLive',
      presentationId: p?.id ?? '',
      slideIndex: (p?.slideCount ?? 1) - 1,
    });
    return p?.slideCount ?? 0;
  });
  expect(last).toBeGreaterThan(1);
  await expect(win.getByTestId('show-next')).toBeDisabled();
  await expect(win.getByTestId('show-back')).toBeEnabled();
  expect(await primaries(win)).toEqual([]);
  await app.close();
});
