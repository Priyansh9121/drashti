import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage, operatorReady, type PageGlobals, relaunchApp } from './helpers';

/*
 * Simple Mode's first steps (Phase B of Sessions 31–36): three short steps the first time Simple Mode opens
 * on a library, shown once and skippable, never while a slide is live, in the window's own flow (never over
 * the big buttons), and "seen" kept through a channel Simple Mode allows. Tests start without them
 * (DRASHTI_TEST_NO_WIZARD), so these ask for them with '0'.
 */

const FIRST_RUN = { DRASHTI_TEST_NO_WIZARD: '0' };
/** A fresh library as a person's starts (Session 50): without the tests' placeholder presentations. */
const FRESH = { ...FIRST_RUN, DRASHTI_TEST_SEED_PLACEHOLDERS: '' };

const toSimple = (win: Awaited<ReturnType<typeof operatorPage>>) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
const toPro = (win: Awaited<ReturnType<typeof operatorPage>>) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
const stillToCome = (win: Awaited<ReturnType<typeof operatorPage>>) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.app.simpleFirstRun());

test('a fresh library’s Simple Mode shows the three first steps once; Skip ends them, and they never come again', async () => {
  const { app, userData } = await launchApp(FRESH);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await toSimple(win);
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const steps = win.getByTestId('simple-first-run');
  await expect(steps).toBeVisible();
  await expect(steps).toHaveAttribute('data-step', '1');
  await expect(steps).toContainText('First steps, 1 of 3: Choose tonight’s playlist');
  // In the flow, above the big buttons and never over them.
  const [box, buttons] = await Promise.all([
    steps.boundingBox(),
    win.getByTestId('simple-buttons').boundingBox(),
  ]);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(buttons?.y ?? 0);
  await expectNoSeriousA11yIssues(win, 'Simple Mode’s first steps');
  // Next step goes on to the second.
  await steps.getByTestId('simple-first-run-next').click();
  await expect(steps).toHaveAttribute('data-step', '2');
  await expect(steps).toContainText('Next and Back');
  // Skip ends them, and says so to the main process.
  await steps.getByTestId('simple-first-run-skip').click();
  await expect(steps).toBeHidden();
  await expect.poll(() => stillToCome(win)).toBe(false);
  // Simple Mode again, and after a restart: never again for this library.
  await toPro(win);
  await toSimple(win);
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await app.close();
  const again = await relaunchApp(userData, FRESH);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await toSimple(win2);
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  expect(await stillToCome(win2)).toBe(false);
  await expect(win2.getByTestId('simple-first-run')).toHaveCount(0);
  await again.app.close();
});

test('never while a slide is live: not then, but the next time Simple Mode opens with none up, until a slide goes up', async () => {
  const { app } = await launchApp(FIRST_RUN);
  const win = await operatorPage(app);
  await operatorReady(win);
  const live = () =>
    win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const id =
        (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
      await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
    });
  // A slide is up as Simple Mode opens: no steps, and they are still to come.
  await live();
  await toSimple(win);
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // The window has the show's state (it says what is live), so it has decided: no steps.
  await expect(win.getByTestId('live-text')).toContainText('Live:');
  await expect(win.getByTestId('simple-first-run')).toHaveCount(0);
  expect(await stillToCome(win)).toBe(true);
  // Cleared, and Simple Mode opens again: the steps come.
  await win.getByTestId('simple-clear-all').click();
  await toPro(win);
  await toSimple(win);
  const steps = win.getByTestId('simple-first-run');
  await expect(steps).toBeVisible();
  // They take no keys: Black-out's works while they show.
  await win.keyboard.press('b');
  await expect(win.getByTestId('simple-blackout')).toHaveText('Black-out is on');
  await win.keyboard.press('b');
  await expect(win.getByTestId('simple-blackout')).toHaveText('Black-out');
  await expect(steps).toBeVisible();
  // A slide going up (here from the bridge, as a phone's would) ends them for good.
  await live();
  await expect(steps).toBeHidden();
  await expect.poll(() => stillToCome(win)).toBe(false);
  await toPro(win);
  await app.close();
});
