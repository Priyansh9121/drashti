import { expect, test } from '@playwright/test';
import { launchApp, openLibrary, operatorPage, operatorReady, slideEditorWindow } from './helpers';
import { logText } from './log-lines';

type FitTestGlobals = typeof globalThis & { drashtiTestFitFailure?: () => Promise<void> };

// MS-2: the queue's unit tests and the browser fixture supply their own reporter. These tests exercise each actual
// window's registration, its console, the IPC bridge and Main's log. The seam only makes a queued report throw.
for (const target of ['operator', 'slide editor'] as const) {
  test(`a failing fit report in the ${target} reaches its console and Main while the window keeps working`, async () => {
    const { app, userData } = await launchApp({ DRASHTI_TEST_FIT_FAILURES: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      let page = win;
      if (target === 'slide editor') {
        await openLibrary(win);
        await win
          .getByTestId('presentation-list')
          .getByTestId('presentation-row')
          .filter({ hasText: 'Language test slides' })
          .click();
        await win.getByTestId('edit-slides').click();
        page = (await slideEditorWindow(app)).ed;
      }
      const caught: string[] = [];
      const uncaught: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Placeholder fit report failure'))
          caught.push(message.text());
      });
      page.on('pageerror', (error) => uncaught.push(error.message));
      await expect
        .poll(() => page.evaluate(() => typeof (globalThis as FitTestGlobals).drashtiTestFitFailure))
        .toBe('function');
      // Each promise resolves only when the later, successful box in the same batch was measured too.
      for (let i = 0; i < 3; i++)
        await page.evaluate(() => (globalThis as FitTestGlobals).drashtiTestFitFailure?.());
      await expect.poll(() => caught).toHaveLength(1);
      expect(caught[0]).toContain(
        `Render error in the ${target === 'operator' ? 'operator window' : 'slide editor'} (caught)`,
      );
      const log = () => logText(userData);
      // Main names the operator specially; a separate editor uses its ordinary control-window log name.
      const loggedWindow = target === 'operator' ? 'operator' : 'a window';
      await expect
        .poll(log)
        .toContain(`Render error in ${loggedWindow} (caught): Error: Placeholder fit report failure`);
      expect(uncaught).toEqual([]);
      await expect(page.locator('[data-window-error]')).toHaveCount(0);
      if (target === 'operator') {
        await openLibrary(win);
        await expect(win.getByTestId('presentation-list')).toBeVisible();
      } else {
        await page.getByRole('tab', { name: 'Words', exact: true }).click();
        await expect(page.getByRole('tab', { name: 'Words', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.getByTestId('editor-canvas')).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });
}

test('the fit-report test script is absent without its test switch', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(await win.evaluate(() => typeof (globalThis as FitTestGlobals).drashtiTestFitFailure)).toBe(
      'undefined',
    );
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Language test slides' })
      .click();
    await win.getByTestId('edit-slides').click();
    const { ed } = await slideEditorWindow(app);
    expect(await ed.evaluate(() => typeof (globalThis as FitTestGlobals).drashtiTestFitFailure)).toBe(
      'undefined',
    );
  } finally {
    await app.close();
  }
});
