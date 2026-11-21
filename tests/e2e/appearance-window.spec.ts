import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { APPEARANCE_FAMILIES, BUILT_IN, familyOf } from '../../src/shared/appearance/appearances';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  OWN_APPEARANCE,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';

/*
 * The Appearance window (Session 60, the owner's Q60-36 (4) and Q60-45: 64 appearances): every one in its family,
 * found by a word of its name or its family, favourites first (kept on this computer), and Moving: On / Off with what
 * the chosen one moves in words. One Tab stop for the choices, the arrows move the choice; it fits CI's 1024 × 645
 * operator window, and axe passes in a dark and a light appearance. Placeholder content only.
 */

const sheet = (win: Page) => win.getByTestId('appearance-dialog');
const choices = (win: Page) => sheet(win).locator('[data-testid="appearance-choice"]:visible');
const family = (win: Page, name: string) =>
  sheet(win).locator(`[data-testid="appearance-family"][data-family="${name}"]`);

async function openWindow(win: Page, app: Parameters<typeof chooseMenuItem>[0]): Promise<void> {
  await chooseMenuItem(app, 'appearance-window');
  await expect(sheet(win)).toBeVisible();
}

test('every appearance in its family, in the window’s order; found by a word of its name or its family; fits 1024 × 645', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1024, height: 645 });
  await operatorReady(win);
  await openWindow(win, app);
  // Follow the computer, then each family with its heading, in the window's order.
  const shown = await sheet(win)
    .locator('[data-testid="appearance-family"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-family')));
  expect(shown).toEqual([...APPEARANCE_FAMILIES]);
  for (const name of APPEARANCE_FAMILIES) {
    await expect(family(win, name).getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(family(win, name).locator('[data-testid="appearance-choice"]')).toHaveCount(
      BUILT_IN.filter((a) => familyOf(a) === name).length,
    );
  }
  await expect(choices(win)).toHaveCount(BUILT_IN.length + 1);
  // It fits: nothing wider than the window, nothing below it but what scrolls inside the sheet.
  const box = await sheet(win).boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 2000)).toBeLessThanOrEqual(1024);
  expect((box?.y ?? 0) + (box?.height ?? 2000)).toBeLessThanOrEqual(645);
  expect(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Found by a word of its name or of its family; nothing found says so in words.
  const search = sheet(win).getByRole('searchbox', { name: 'Find an appearance' });
  await search.fill('jewels');
  await expect(choices(win)).toHaveCount(BUILT_IN.filter((a) => familyOf(a) === 'Jewels').length);
  await search.fill('diwali');
  await expect(choices(win)).toHaveCount(2);
  await expect(sheet(win).locator('[data-choice="diwali"]')).toBeVisible();
  await expect(sheet(win).locator('[data-choice="dev-diwali"]')).toBeVisible();
  await search.fill('no such look');
  await expect(choices(win)).toHaveCount(0);
  await expect(sheet(win).getByText('No appearance is called that.')).toBeVisible();
  await search.fill('');
  await expect(choices(win)).toHaveCount(BUILT_IN.length + 1);
  await app.close();
});

test('favourites: the chosen one starred, shown first, kept over a restart and unstarred', async () => {
  // A choice kept over a restart gives its own switch (ci.yml's job in Black starts every other test in Black).
  const first = await launchApp(OWN_APPEARANCE);
  let win = await operatorPage(first.app);
  await operatorReady(win);
  await openWindow(win, first.app);
  await sheet(win).locator('[data-choice="manek"]').click();
  await expect(sheet(win).locator('[data-choice="manek"]')).toHaveAttribute('aria-checked', 'true');
  const star = sheet(win).getByTestId('appearance-favourite');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toHaveAccessibleName('Favourite: Manek');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(family(win, 'Favourites').locator('[data-choice="manek"]')).toBeVisible();
  const order = await sheet(win)
    .locator('[data-testid="appearance-family"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-family')));
  expect(order[0]).toBe('Favourites');
  await first.app.close();
  const again = await relaunchApp(first.userData, OWN_APPEARANCE);
  win = await operatorPage(again.app);
  await operatorReady(win);
  await openWindow(win, again.app);
  await expect(family(win, 'Favourites').locator('[data-choice="manek"]')).toBeVisible();
  await sheet(win).getByTestId('appearance-favourite').click();
  await expect(family(win, 'Favourites')).toHaveCount(0);
  await again.app.close();
});

test('Moving: On / Off says what the chosen one moves, and Off stops it at once; the keyboard and axe, dark and light', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_APPEARANCE: 'diwali' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1024, height: 645 });
  await operatorReady(win);
  await openWindow(win, app);
  const moving = sheet(win).getByRole('switch', { name: 'Moving' });
  await expect(moving).toHaveAttribute('aria-checked', 'true');
  await expect(sheet(win).getByTestId('appearance-moving-words')).toContainText('Diwali moves:');
  await expect(sheet(win).getByTestId('appearance-moving-words')).toContainText('glow');
  await moving.click();
  await expect(moving).toHaveAttribute('aria-checked', 'false');
  await expect(win.locator('html')).toHaveAttribute('data-moving', 'off');
  await moving.click();
  await expect(win.locator('html')).toHaveAttribute('data-moving', 'on');
  // One Tab stop for the choices: it lands on the chosen one, and the arrows move the choice.
  const chosen = sheet(win).locator('[data-testid="appearance-choice"][aria-checked="true"]');
  await chosen.focus();
  await expect(chosen).toHaveAttribute('data-choice', 'diwali');
  await win.keyboard.press('ArrowRight');
  await expect(
    sheet(win).locator('[data-testid="appearance-choice"][aria-checked="true"]'),
  ).not.toHaveAttribute('data-choice', 'diwali');
  await expect(sheet(win).locator('[data-testid="appearance-choice"][aria-checked="true"]')).toBeFocused();
  // axe in a dark appearance and in a light one ("both modes").
  for (const id of ['black', 'white']) {
    await sheet(win).locator(`[data-choice="${id}"]`).click();
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await expectNoSeriousA11yIssues(win, `the Appearance window in ${id}`);
  }
  await app.close();
});
