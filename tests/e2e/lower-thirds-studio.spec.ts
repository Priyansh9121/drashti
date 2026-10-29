import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  launchApp,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  windowShowing,
} from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * The Lower Thirds studio (Session 55, Part 16): Lower Thirds opens a window of its own with a live preview, where
 * a lower third is made from a template (placeholder words only) or from nothing: its words, the style they sit
 * in, its colours, font, place, how it comes in and goes out, a moving background, and whether it hides itself
 * after the seconds chosen (R). Saved, it is in the operator window's panel too; shown from the studio, it is on a
 * placeholder hall screen as made, and it goes out the way chosen. One set to 5 seconds goes by itself. The window
 * at CI's 1024 × 645 and at 1280 × 720: everything in reach. A lower third made before the studio draws as it did.
 * Placeholder words only.
 */

const isStudio = (p: Page) => p.url().includes('lower-thirds.html');
const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

async function start(): Promise<{ app: ElectronApplication; win: Page; out: Page }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  await setUpScreen(win, 'Main Hall', 0);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
  return { app, win, out };
}

/** The studio, opened from the Lower Thirds panel as the operator would (More tools). */
async function openStudio(app: ElectronApplication, win: Page): Promise<Page> {
  await openMoreTools(win);
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  const button = panel.getByTestId('lower-third-studio');
  await expect(button).toBeVisible();
  await button.click();
  const studio = await windowShowing(app, isStudio, 'the Lower Thirds studio');
  await expect(studio).toHaveTitle('Drashti Lower Thirds');
  await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
  return studio;
}

async function tab(studio: Page, name: string): Promise<void> {
  await studio.getByRole('tab', { name }).click();
  await expect(studio.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function sizeStudio(app: ElectronApplication, studio: Page, size: { width: number; height: number }) {
  await app.evaluate(({ BrowserWindow }, want) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
      ?.setContentSize(want.width, want.height);
  }, size);
  await studio.setViewportSize(size);
  await expect
    .poll(() => studio.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
}

/** Wholly inside the window, and not under another of these. */
async function expectInView(locator: Locator, what: string): Promise<void> {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  const size = await locator.page().evaluate(() => [innerWidth, innerHeight]);
  expect(box, what).not.toBeNull();
  const b = box ?? { x: -1, y: -1, width: 0, height: 0 };
  expect(b.x, what).toBeGreaterThanOrEqual(-0.5);
  expect(b.y, what).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, what).toBeLessThanOrEqual((size[0] ?? 0) + 0.5);
  expect(b.y + b.height, what).toBeLessThanOrEqual((size[1] ?? 0) + 0.5);
}

test('Lower Thirds opens the studio, a window of its own with a live preview: one made from a template, its style, background, font, in and out chosen, saved, and shown from the studio as made; axe passes', async () => {
  test.setTimeout(180_000);
  const { app, win, out } = await start();
  const studio = await openStudio(app, win);
  await expectNoSeriousA11yIssues(studio, 'the studio, with no lower thirds yet');

  // From a template: placeholder words, its look, its animation; the live preview plays it.
  await studio.getByTestId('studio-templates').click();
  await studio.locator('[data-testid="studio-template"][data-template="ribbon"]').click();
  const preview = studio.getByTestId('lower-third-preview');
  const drawn = preview.getByTestId('lower-third-layer');
  await expect(drawn).toHaveAttribute('data-lt-style', 'ribbon');
  await expect(drawn).toContainText('Placeholder');
  await tab(studio, 'Words');
  const lines = studio.getByTestId('lower-third-line');
  await lines.nth(0).fill('Placeholder speaker');
  await lines.nth(1).fill('Placeholder title');
  await expect(drawn).toContainText('Placeholder speaker');
  await studio.getByTestId('lower-third-where').locator('[data-choice="hall"]').click();

  // Its style, accent and font: the preview follows at once.
  await tab(studio, 'Style');
  await studio.getByTestId('lower-third-style').locator('[data-choice="pill"]').click();
  await expect(drawn).toHaveAttribute('data-lt-style', 'pill');
  await studio.getByTestId('lower-third-font').selectOption('Mukta');
  await expect(drawn).toHaveAttribute('data-lt-font', 'Mukta');
  await studio.getByTestId('lower-third-align').locator('[data-choice="centre"]').click();
  await expectNoSeriousA11yIssues(studio, 'the studio: Style');

  // In and out, each found by its words.
  await tab(studio, 'Animation');
  await studio.getByTestId('lower-third-search').fill('reveal up');
  await studio.locator('[data-testid="lower-third-animation"][data-id="reveal-up-steady"]').click();
  await expect(studio.getByTestId('lower-third-animation-chosen')).toHaveText('Reveal up');
  await expect(preview).toHaveAttribute('data-playing', 'true');
  await studio.getByTestId('lower-third-out-search').fill('blinds');
  await studio.locator('[data-testid="lower-third-out-animation"][data-id="blinds-quick"]').click();
  await expect(studio.getByTestId('lower-third-out-chosen')).toHaveText('Blinds out, quick');
  await expectNoSeriousA11yIssues(studio, 'the studio: Animation');

  // A moving background: it moves in the preview while the lower third is up.
  await tab(studio, 'Background');
  await studio.getByTestId('lower-third-motion').locator('[data-choice="shine"]').click();
  await expect(drawn).toHaveAttribute('data-lt-motion', 'shine');

  await studio.getByTestId('lower-third-save').click();
  const row = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder speaker' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-saved', 'true');
  // The operator window's panel lists it too.
  const panelRow = win.getByTestId('lower-third-row').filter({ hasText: 'Placeholder speaker' });
  await expect(panelRow).toHaveCount(1);

  // Shown from the studio: on the hall's screen as made, the panel's button saying Hide.
  await studio.getByTestId('studio-show').click();
  const onScreen = out.getByTestId('lower-third-layer');
  await expect(onScreen).toContainText('Placeholder speaker');
  await expect(onScreen).toHaveAttribute('data-lt-style', 'pill');
  await expect(onScreen).toHaveAttribute('data-lt-motion', 'shine');
  await expect(onScreen).toHaveAttribute('data-lt-animation', 'reveal-up-steady');
  expect(
    await onScreen.locator('[data-lt-line]').first().evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/^"?Mukta"?, "?Mukta Vaani"?/u);
  await expect(panelRow.getByTestId('lower-third-show')).toHaveText('Hide');
  await expect(studio.getByTestId('studio-show')).toHaveText('Hide');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  // Its moving background runs while it is up.
  const movedAt = await onScreen.getAttribute('data-lt-motion-at');
  await expect.poll(() => onScreen.getAttribute('data-lt-motion-at')).not.toBe(movedAt);

  // Hidden from the studio: it goes out as the blinds, then it is gone.
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-animation', 'blinds-quick');
  await expect(onScreen).toHaveCount(0);
  expect((await snapshot(win)).state.layers.lowerThird).toBeNull();
  await expect(panelRow.getByTestId('lower-third-show')).toHaveText('Show');
  await app.close();
});

test('R: one set to hide itself after 5 seconds goes by itself, playing its out; one made before the studio shows as it did, a box going out the way it came', async () => {
  test.setTimeout(150_000);
  const { app, win, out } = await start();
  const studio = await openStudio(app, win);
  await studio.getByTestId('studio-new').click();
  await tab(studio, 'Words');
  await studio.getByTestId('lower-third-line').nth(0).fill('Placeholder for five seconds');
  await studio.getByTestId('lower-third-where').locator('[data-choice="hall"]').click();
  await tab(studio, 'Timing');
  await studio.getByTestId('lower-third-stays').locator('[data-choice="seconds"]').click();
  await studio.getByTestId('lower-third-seconds').fill('5');
  await studio.getByTestId('lower-third-seconds').blur();
  await studio.getByTestId('lower-third-save').click();
  const row = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder for five seconds' });
  await expect(row).toHaveAttribute('data-saved', 'true');
  await expect(row).toContainText('5 s');

  await studio.getByTestId('studio-show').click();
  const onScreen = out.getByTestId('lower-third-layer');
  await expect(onScreen).toContainText('Placeholder for five seconds');
  const shownAt = (await snapshot(win)).state.layers.lowerThird?.shownAt ?? 0;
  expect((await snapshot(win)).state.layers.lowerThird?.seconds).toBe(5);
  // By itself, 5 s after it went up: its out from then, by the engine's clock.
  await expect(onScreen).toHaveCount(0, { timeout: 15_000 });
  const off = (await snapshot(win)).state.lowerThirdOff;
  expect(off?.at).toBe(shownAt + 5000);
  await expect(studio.getByTestId('studio-show')).toHaveText('Show');

  // One kept before the studio: no style, no seconds, its out its in backwards.
  const made = await win.evaluate(async (look) => {
    const input: LowerThirdInput = {
      lines: ['Placeholder older', 'Placeholder title', ''],
      look,
      where: 'hall',
      animation: 'slide-left-steady',
    };
    const r = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, input);
    if (!r.ok) throw new Error(r.message);
    return r.id;
  }, DEFAULT_LOWER_THIRD_LOOK);
  const older = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder older' });
  await expect(older).toHaveCount(1);
  await older.getByRole('button').first().click();
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-id', made);
  await expect(onScreen).toHaveAttribute('data-lt-style', 'box');
  await expect(onScreen).toHaveAttribute('data-lt-motion', 'none');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  const band = onScreen.locator('[data-lt-shape]');
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(16, 24, 40, 0.85)');
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-animation', 'slide-left-steady');
  await expect(onScreen).toHaveCount(0);
  await app.close();
});

test('the studio at CI’s 1024 × 645 and at 1280 × 720: the preview, every tab’s controls and Save in reach, nothing sideways; axe passes', async () => {
  test.setTimeout(180_000);
  const { app, win } = await start();
  const studio = await openStudio(app, win);
  await studio.getByTestId('studio-templates').click();
  await studio.locator('[data-testid="studio-template"]').first().click();
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    const what = `the studio at ${String(size.width)} × ${String(size.height)}`;
    await sizeStudio(app, studio, size);
    expect(await studio.evaluate(() => document.documentElement.scrollWidth <= innerWidth), what).toBe(true);
    await expectFits(studio.getByTestId('lt-studio'), what);
    await expectInView(studio.getByTestId('lower-third-preview'), `${what}: the preview`);
    const box = await studio.getByTestId('lower-third-preview').boundingBox();
    expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - 16 / 9), `${what}: 16:9`).toBeLessThan(0.02);
    expect(box?.width ?? 0, `${what}: the preview big enough to see`).toBeGreaterThanOrEqual(400);
    await expectInView(studio.getByTestId('lower-third-save'), `${what}: Save`);
    await expectInView(studio.getByTestId('studio-show'), `${what}: Show`);
    await expectInView(studio.getByTestId('studio-list'), `${what}: the list`);
    // Each tab: its last control reached (scrolled to within its panel when it must be), nothing cut off sideways.
    const last: Record<string, string> = {
      Words: 'lower-third-where',
      Style: 'lower-third-bottom',
      Animation: 'lower-third-out-animations',
      Background: 'lower-third-motion',
      Timing: 'lower-third-stays',
    };
    for (const [name, testId] of Object.entries(last)) {
      await tab(studio, name);
      const control = studio.getByTestId(testId);
      await control.scrollIntoViewIfNeeded();
      await expectInView(control, `${what}: ${name}`);
      expect(
        await studio.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${what}: ${name}`,
      ).toBe(true);
      await expectNoSeriousA11yIssues(studio, `${what}: ${name}`);
    }
  }
  await app.close();
});
