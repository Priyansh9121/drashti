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

test('Loading waits half a second (Sessions 31–36): a slow guide says “Opening the guide…” then, not at 100 ms', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_GUIDES_DELAY_MS: '2500' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // Timed in the page itself, from when the guides open: whether Loading's words show at 100 ms and at
  // 600 ms, and when they first do.
  await win.evaluate(() => {
    const seen: { opened?: number; shown?: number; at100?: boolean; at600?: boolean } = {};
    (globalThis as { drashtiLoading?: typeof seen }).drashtiLoading = seen;
    const showing = () =>
      document.querySelector('[data-testid="guides"] [role="status"] [data-shown="true"]') !== null;
    new MutationObserver(() => {
      const now = performance.now();
      if (seen.opened === undefined && document.querySelector('[data-testid="guides"]')) {
        seen.opened = now;
        setTimeout(() => (seen.at100 = showing()), 100);
        setTimeout(() => (seen.at600 = showing()), 600);
      }
      if (seen.shown === undefined && showing()) seen.shown = now;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await chooseMenuItem(app, 'guides');
  const guides = win.getByTestId('guides');
  await expect(guides).toBeVisible();
  const words = guides.getByText('Opening the guide…');
  await expect(words).toBeVisible();
  const seen = () =>
    win.evaluate(
      () =>
        (
          globalThis as {
            drashtiLoading?: { opened?: number; shown?: number; at100?: boolean; at600?: boolean };
          }
        ).drashtiLoading ?? {},
    );
  await expect.poll(async () => (await seen()).at600).toBe(true);
  const at = await seen();
  expect(at.at100).toBe(false);
  expect((at.shown ?? 0) - (at.opened ?? 0)).toBeGreaterThanOrEqual(490);
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
