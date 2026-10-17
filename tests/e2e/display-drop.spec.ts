import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, outputPage, setUpScreen } from './helpers';

/*
 * A display that drops for a moment (Sessions 31–36, ROB-4): projectors and HDMI converters often do as
 * they are switched or warm up. Its output is hidden, not closed, for up to 10 s; if the display comes back
 * in that time, the same page goes back on it, never loaded again (no warm-up, no black). Gone for longer,
 * it closes as before. The display here is a pretend one (DRASHTI_TEST_DISPLAY_CHANGES).
 */

/** The output windows there are, and whether each is shown. */
const outputWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('output.html'))
      .map((w) => w.isVisible()),
  );

const pretendDisplays = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

test('a display that drops for a moment keeps its output: hidden, then back on it as the same page', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
  });
  const win = await operatorPage(app);
  const index = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.screens.get()).displays.findIndex(
      (d) => d.label === 'Extra display 1',
    ),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await setUpScreen(win, 'Main Hall', index);
  const output = await outputPage(app);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const first = (await d.library.listPresentations())[0]?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: first, slideIndex: 0 });
  });
  const words = output.locator('[data-lang="en"]');
  await expect(words).toHaveText('Welcome to the test slide');
  const loadedAt = await output.evaluate(() => performance.timeOrigin);
  await expect.poll(() => outputWindows(app)).toEqual([true]);

  // The display goes: its output is hidden, not closed...
  await pretendDisplays(app, 0);
  await expect.poll(() => outputWindows(app), { timeout: 2000, intervals: [50] }).toEqual([false]);
  // ...and it comes back within 2 s: the same page is shown on it again, the slide still up.
  await pretendDisplays(app, 1);
  await expect.poll(() => outputWindows(app), { timeout: 2000, intervals: [50] }).toEqual([true]);
  expect(await output.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
  await expect(words).toHaveText('Welcome to the test slide');

  // Gone for longer than 10 s: closed, as before.
  await pretendDisplays(app, 0);
  await expect.poll(() => outputWindows(app), { timeout: 2000, intervals: [50] }).toEqual([false]);
  await expect.poll(() => outputWindows(app), { timeout: 15_000 }).toEqual([]);
  await app.close();
});
