import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Diya, Drashti's own look (Session 26g), in the real window: the mark beside the name, the lamp's
 * light falling from it, the unlit lamp in empty places, and nothing in that light that could be
 * taken for a warning. Placeholder content only.
 */

/** The lamp's light, as getComputedStyle writes it. */
const LAMP = /rgba\(255, 176, 128, 0\.\d+\)/u;
/** The warning colour (#f2b23e), which the lamp's light never is. */
const WARNING = 'rgb(242, 178, 62)';

const style = (l: Locator, prop: string, pseudo: string | null = null) =>
  l.evaluate((el, { p, ps }) => getComputedStyle(el, ps).getPropertyValue(p), { p: prop, ps: pseudo });

async function lampHeader(header: Locator, name: string) {
  // The mark beside the name, decoration only: the heading still reads "Drashti".
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(header.locator('h1 svg[data-mark]')).toBeVisible();
  // The lamp's light across the header, on the panel's own colour, and the hairline beneath.
  expect(await style(header, 'background-image')).toMatch(LAMP);
  expect(await style(header, 'background-color')).toBe('rgb(30, 16, 29)');
  expect(await style(header, 'background-image', '::after')).toMatch(LAMP);
  expect(await style(header, 'background-image')).not.toContain(WARNING);
}

test('the mark beside the name and the lamp’s light, in Pro Mode and Simple Mode; never a warning', async () => {
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await lampHeader(win.getByTestId('app-header'), 'Drashti');
  // The window: the lamp's light from the top left, over ink, never a filled shape.
  const window = win.locator('.lamp-window').first();
  expect(await style(window, 'background-image')).toMatch(LAMP);
  expect(await style(window, 'background-color')).toBe('rgb(21, 10, 20)');

  // Empty places: the unlit lamp in its faint light, with no colour of a warning.
  const playlists = win.getByText('No playlists yet');
  await expect(playlists).toBeVisible();
  const empty = win.locator('.lamp-empty').filter({ has: playlists });
  await expect(empty.getByTestId('unlit-lamp')).toBeVisible();
  expect(await style(empty, 'background-image')).toMatch(LAMP);
  expect(await style(empty, 'background-color')).toBe('rgba(0, 0, 0, 0)');

  // A warning is still a filled amber rail with an icon and words (the component gallery's).
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
  await chooseMenuItem(app, 'component-gallery');
  const gallery: Page = await opened;
  const warning = gallery
    .getByText('Sound output not connected')
    .locator('xpath=ancestor::div[contains(@class,"border-l-4")][1]');
  await expect(warning).toBeVisible();
  expect(await style(warning, 'background-color')).toBe('rgb(59, 42, 10)');
  expect(await style(warning, 'border-left-color')).toBe(WARNING);
  expect(Number.parseFloat(await style(warning, 'border-left-width'))).toBeGreaterThanOrEqual(4);
  await expect(warning.locator('svg').first()).toBeVisible();
  await gallery.close();

  // Simple Mode: the same mark and light.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  await lampHeader(simple.locator('header').first(), 'Drashti');
  await app.close();
});
