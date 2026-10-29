import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, openLibrary, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';

/*
 * The bottom bar (Session 55, Part 13). The bar of clears is smaller, in one row at 1024 × 645
 * (CI's operator window) and at 1280 × 720, with room above it for Part 8's quick bar: Clear all F1, Slide F2,
 * Background F3, Audio F5, Messages F6, Ticker F7, Wallpaper F12 and Black-out B; F4 and F8 do nothing. A button
 * whose layer has nothing up is dimmed, so what is live shows at a glance. The Wallpaper puts the chosen wallpaper
 * up instead of the picture (black until Part 6 brings wallpapers) and takes it off, as the Logo did; Simple
 * Mode's too. Placeholder slides only.
 */

const BAR = [
  'Clear all F1',
  'Slide F2',
  'Background F3',
  'Audio F5',
  'Messages F6',
  'Ticker F7',
  'Wallpaper F12',
  'Black-out B',
];

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The bar's buttons, each as its words and keys read in one line. */
const barButtons = (bar: Locator) => bar.locator('button:visible:not([aria-label^="What is this?"])');
const barWords = (bar: Locator) =>
  barButtons(bar).evaluateAll((b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()));

/** Every one of the bar's buttons in one row, none cut, the bar not scrolling; its height. */
async function oneRow(win: Page, where: string): Promise<number> {
  const bar = win.getByTestId('layer-bar');
  const boxes = await barButtons(bar).evaluateAll((b) =>
    b.map((x) => {
      const r = x.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, cut: x.scrollWidth > x.clientWidth + 1 };
    }),
  );
  expect(boxes.length, where).toBe(BAR.length);
  const tops = boxes.map((b) => Math.round(b.top));
  expect(Math.max(...tops) - Math.min(...tops), `${where}: one row`).toBeLessThanOrEqual(2);
  expect(
    boxes.filter((b) => b.cut),
    `${where}: no button cut`,
  ).toEqual([]);
  const scrolls = await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(scrolls, `${where}: the bar does not scroll`).toBe(false);
  return (await bar.boundingBox())?.height ?? 0;
}

test('the bar of clears: one row at 1024 × 645 and 1280 × 720, smaller; its buttons with their keys; F4 and F8 do nothing; a button with nothing up dimmed', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const bar = win.getByTestId('layer-bar');
  for (const [width, height] of [
    [1024, 645],
    [1280, 720],
  ] as const) {
    await win.setViewportSize({ width, height });
    await expect.poll(() => barWords(bar)).toEqual(BAR);
    const tall = await oneRow(win, `${width} × ${height}`);
    // Smaller than before (Session 54's bar was 57 px tall with its buttons' keys under their words).
    expect(tall, `${width} × ${height}: the bar's height`).toBeLessThanOrEqual(44);
  }
  await expectNoSeriousA11yIssues(win, 'the bottom bar');

  // Nothing up: every button dimmed, Clear all and the clears off; the Wallpaper and Black-out still pressable.
  const button = (words: string) => bar.getByRole('button', { name: new RegExp(`^${words}`, 'u') });
  for (const words of [
    'Clear all',
    'Clear slide',
    'Clear background',
    'Clear audio',
    'Clear messages',
    'Clear ticker',
  ])
    await expect(button(words), words).toBeDisabled();
  for (const words of ['Wallpaper', 'Black-out']) {
    await expect(button(words), words).toBeEnabled();
    await expect(button(words), words).toHaveAttribute('data-dimmed', 'true');
  }

  // A slide up: its clear lights up and Clear all can be pressed; the rest stay dimmed.
  await setUpScreen(win);
  const audience = await outputPage(app);
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await win.getByTestId('slide-thumb').first().click();
  await expect(button('Clear slide')).toHaveAttribute('data-lit', 'true');
  await expect(button('Clear all')).toBeEnabled();
  await expect(button('Clear background')).toBeDisabled();

  // F4 and F8 do nothing; F12 puts the wallpaper up over the slide (black: no wallpaper chosen yet), and off.
  const before = await state(win);
  await win.keyboard.press('F4');
  await win.keyboard.press('F8');
  expect((await state(win)).layers).toEqual(before.layers);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(button('Wallpaper is on')).toHaveAttribute('data-lit', 'true');
  await expect(button('Wallpaper is on')).not.toHaveAttribute('data-dimmed');
  // The slide stays up underneath, as under the Logo.
  expect((await state(win)).layers.slide?.presentationId).toBe(before.layers.slide?.presentationId);
  await button('Wallpaper is on').click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(button('Wallpaper')).toHaveAttribute('data-dimmed', 'true');
  await app.close();
});

test('Simple Mode’s buttons too: its Clear all dimmed with nothing up; the Wallpaper in the Logo’s place, F12 or the button putting the wallpaper up and taking it off', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1024, height: 645 });
  await setUpScreen(win);
  const audience = await outputPage(app);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'))).toMatchObject({
    ok: true,
  });
  // Its Clear all dimmed with nothing up, as the bar of clears' is, and pressable once something is.
  const clearAll = win.getByTestId('simple-clear-all');
  await expect(clearAll).toBeDisabled();
  await expect(clearAll).toHaveAttribute('data-dimmed', 'true');
  const [first] = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations());
  await win.evaluate(
    (presentationId) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 }),
    first?.id ?? '',
  );
  await expect(clearAll).toBeEnabled();
  await expect(clearAll).not.toHaveAttribute('data-dimmed');
  const wallpaper = win.getByTestId('simple-wallpaper');
  await expect(wallpaper).toBeVisible();
  await expect(win.getByTestId('simple-logo')).toHaveCount(0);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(wallpaper).toHaveText(/Wallpaper is on/u);
  await wallpaper.click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(wallpaper).not.toHaveText(/is on/u);
  await app.close();
});
