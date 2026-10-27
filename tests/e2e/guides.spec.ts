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
  const { app, access } = await launchApp();
  // Every request off this computer is stopped and written down: none may be made. Drashti's own checks of its
  // access (Session 54) go to the access list, not the guides': they are let through (the tests' list is the
  // stand-in on this computer).
  await app.evaluate(({ session }, list) => {
    const g = globalThis as { drashtiRequestsOut?: string[] };
    g.drashtiRequestsOut = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        if (new URL(details.url).origin === list) {
          callback({});
          return;
        }
        g.drashtiRequestsOut?.push(details.url);
        callback({ cancel: true });
      },
    );
  }, new URL(access.url).origin);
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

test('a curated answer comes first, in its guide’s own words, and opens the guide at its passage', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  const search = guides.getByRole('searchbox');
  const results = guides.getByTestId('guide-results');
  // Two words find the answer first, above the passages that hold them, in the guide's words.
  await search.fill('screen black');
  const first = results.getByRole('button').first();
  await expect(first).toHaveAttribute('data-testid', 'guide-answer');
  await expect(first).toContainText('When a screen is black or frozen, what do I do?');
  await expect(first).toContainText(
    'Open the screens dashboard: its picture shows what that screen really shows.',
  );
  await expectNoSeriousA11yIssues(win, 'an answer in the guides’ search');
  await first.click();
  const shown = guides.locator('[data-passage][data-current="true"]');
  await expect(shown).toContainText('A screen is black or frozen.');
  await expect(shown).toBeInViewport();
  // A whole question, which no passage holds word for word, still finds its answer, and only that.
  await search.fill('When the stream says Reconnecting, what do I do?');
  await expect(results.getByTestId('guide-answer')).toHaveCount(1);
  await expect(results.getByTestId('guide-answer')).toContainText(
    'Do nothing: Drashti tries again by itself',
  );
  await expect(results).not.toContainText('Nothing in the guides holds every word');
  await win.keyboard.press('Escape');
  await expect(guides).toBeHidden();
  await app.close();
});

test('Loading waits half a second (Sessions 31–36): a slow guide says “Opening the guide…” then, never sooner (Session 37: timed by Loading itself)', async () => {
  // The guide arrives 4 s after it is asked for (a test switch): time enough for Loading to speak on any
  // machine, however slow, before the guide replaces it.
  const { app } = await launchApp({ DRASHTI_TEST_GUIDES_DELAY_MS: '4000' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  // Its words show while the guide is still on its way.
  const words = guides.getByText('Opening the guide…');
  await expect(words).toBeVisible();
  // Loading writes on itself when it came and when its words showed (performance.now(), in the page), so the
  // gap is measured where it happens: no sample timed from outside, which a busy machine throws off, and no
  // fake clock, which upsets the app's own timers.
  const status = guides.getByRole('status').filter({ hasText: 'Opening the guide…' });
  const since = Number(await status.getAttribute('data-since'));
  const shownAt = Number(await status.getAttribute('data-shown-at'));
  expect(since).toBeGreaterThan(0);
  expect(shownAt - since).toBeGreaterThanOrEqual(499);
  // The guide comes, and the words go.
  await expect(guides.getByRole('heading', { level: 1 })).toContainText('The operator', { timeout: 10_000 });
  await expect(words).toBeHidden();
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
