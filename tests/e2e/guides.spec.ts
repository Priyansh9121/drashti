import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * The guides inside Drashti (Phase B of Sessions 31–36): Help › Guides… shows the operator, presenter,
 * admin and setup-day guides, searchable, with their pictures, read from the files shipped beside the
 * app and never from the internet. Simple Mode sees the operator's and the presenter's only.
 */

const menuHas = (app: Awaited<ReturnType<typeof launchApp>>['app'], id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId) != null, id);

test('Help › Guides…: the four guides offline, "black" finds the Black-out row, pictures from beside the app, and nothing goes out', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  // Every request off this computer is stopped and written down: none may be made.
  await app.evaluate(({ session }) => {
    const g = globalThis as { drashtiRequestsOut?: string[] };
    g.drashtiRequestsOut = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        g.drashtiRequestsOut?.push(details.url);
        callback({ cancel: true });
      },
    );
  });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  expect(await menuHas(app, 'guides')).toBe(true);
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  // The four guides, the operator's first.
  await expect(guides.getByRole('tab')).toHaveText(['Operator', 'Presenter', 'Admin', 'Setup day']);
  await expect(guides.getByRole('heading', { level: 1 })).toContainText('The operator');
  await expectNoSeriousA11yIssues(win, 'the guides at 1280 × 720');
  // A picture from the guide, shown from the files beside the app.
  const picture = guides.locator('img').first();
  await picture.scrollIntoViewIfNeeded();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  expect(await picture.getAttribute('src')).toMatch(/^drashti-media:\/\/guide\//u);

  // Search: "black" finds the Black-out row of the operator's guide, under its section.
  await guides.getByRole('searchbox').fill('black');
  const results = guides.getByTestId('guide-results');
  const row = results.getByTestId('guide-hit').filter({ hasText: 'B (or .), Black-out' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('2. Running the sabha');
  await row.click();
  // The guide opens at that row, marked.
  const shown = guides.locator('[data-passage][data-current="true"]');
  await expect(shown).toBeVisible();
  await expect(shown).toContainText('Black-out');
  // In view, and still in view once the pictures above it have loaded.
  await expect(shown).toBeInViewport();
  await expect
    .poll(() =>
      guides.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)),
    )
    .toBe(true);
  await expect(shown).toBeInViewport();

  // Esc closes it.
  await win.keyboard.press('Escape');
  await expect(guides).toBeHidden();
  expect(
    await app.evaluate(() => (globalThis as { drashtiRequestsOut?: string[] }).drashtiRequestsOut ?? []),
  ).toEqual([]);
  await app.close();
});

test('Simple Mode’s Help › Guides… shows only the operator’s and the presenter’s guides, and the others cannot be read', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await menuHas(app, 'guides')).toBe(true);
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  await expect(guides.getByRole('tab')).toHaveText(['Operator', 'Presenter']);
  const read = await win.evaluate(async () => {
    const g = (globalThis as PageGlobals).drashti.guides;
    return [await g.read('admin'), await g.read('setup-day')].map((r) => r.ok);
  });
  expect(read).toEqual([false, false]);
  await win.keyboard.press('Escape');
  await expect(guides).toBeHidden();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await app.close();
});
