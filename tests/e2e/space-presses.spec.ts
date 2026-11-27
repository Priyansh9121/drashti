import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, slidesOf } from './helpers';
import { helpOn } from './help';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * Space on a focused button (a25 item 1, in alpha.24 by the owner's 48-item list; the release lead's B, as lead 2
 * scoped it). Space is Next in the operator window, a button focused or not, as the operators press it. Since alpha.24
 * a button the KEYBOARD put the focus on (Tab, or a move the page made from there) is pressed by Space, as on any page:
 * a "?" opens, its Got it closes. Never a show control (a slide's row, a playlist's item, Next, Black-out, the clears):
 * Space stays Next on those. And a button a click focused keeps Space = Next, even after another key has gone down and
 * Chromium shows its ring: Space never presses Black-out, Clear all or Oops again.
 */

const live = (win: Page) => win.getByTestId('live-text');

const blackoutOn = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.blackout);

/** Nothing has the keyboard. */
const letGo = (win: Page) =>
  win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

/** Tab until the keyboard is on an element whose test id `found` takes (at most `max` presses); that test id. */
async function tabTo(win: Page, found: (testId: string) => boolean, max = 150): Promise<string> {
  for (let i = 0; i < max; i++) {
    await win.keyboard.press('Tab');
    const id = await win.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (found(id)) return id;
  }
  throw new Error(`Not reached with Tab in ${String(max)} presses`);
}

test('Space presses a "?" the keyboard put the focus on, and stays Next on a clicked Black-out, a clicked "?" and a Tab-focused slide row (a25 item 1)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  // Wide enough for the top bar's ? (they go below 1280 px).
  await win.setViewportSize({ width: 1410, height: 900 });
  await operatorReady(win);
  await helpOn(win);
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  const slides = slidesOf(win, KIRTAN);
  await slides.nth(1).click();
  await expect(live(win)).toContainText(`${KIRTAN} · slide 2 of 5`);
  const card = win.getByTestId('what-is-this');

  // A "?" reached with Tab: Space opens its words, and the show stays where it was.
  await letGo(win);
  const askId = await tabTo(win, (id) => id.startsWith('what-is-this-'));
  const ask = win.getByTestId(askId);
  await expect(ask).toBeFocused();
  await expect(ask).toHaveAttribute('aria-expanded', 'false');
  await win.keyboard.press('Space');
  await expect(ask).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toBeVisible();
  // Its Got it has the keyboard now (a move the page made from the keyboard's focus): Space presses it too.
  await expect(card.getByRole('button', { name: 'Got it' })).toBeFocused();
  await win.keyboard.press('Space');
  await expect(card).toHaveCount(0);
  await expect(ask).toBeFocused();
  await expect(live(win)).toContainText(`${KIRTAN} · slide 2 of 5`);

  // Black-out clicked on and off: it keeps the focus, and after → (the key that turns Chromium's ring on for it),
  // Space is Next, never Black-out again.
  const blackout = win.getByTestId('blackout-button');
  await blackout.click();
  await expect.poll(() => blackoutOn(win)).toBe(true);
  await blackout.click();
  await expect.poll(() => blackoutOn(win)).toBe(false);
  await expect(blackout).toBeFocused();
  await win.keyboard.press('ArrowRight');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 3 of 5`);
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 4 of 5`);
  expect(await blackoutOn(win)).toBe(false);
  await expect(blackout).toBeFocused();

  // A "?" clicked: its Got it takes the focus from the click, so Space is Next and the words stay open; Got it clicked
  // gives the focus back to the ?, and Space is Next there too, the words staying shut.
  const nextBack = win.getByTestId('what-is-this-nextback');
  await nextBack.click();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Got it' })).toBeFocused();
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 5 of 5`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toHaveCount(0);
  await expect(nextBack).toBeFocused();
  await win.keyboard.press('ArrowLeft');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 4 of 5`);
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 5 of 5`);
  await expect(nextBack).toHaveAttribute('aria-expanded', 'false');

  // A slide's row reached with Tab (a show control): Space is Next from what is live, never that row put up.
  await slides.nth(2).click();
  await expect(live(win)).toContainText(`${KIRTAN} · slide 3 of 5`);
  await letGo(win);
  await tabTo(win, (id) => id === 'slide-thumb');
  const row = win.locator('[data-testid="slide-thumb"]:focus');
  await expect(row).toHaveCount(1);
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 4 of 5`);
  await expect(row).toHaveCount(1);
  await app.close();
});

/** Reach a named button with the keyboard too (the mode switch has no test id). */
async function tabToButton(win: Page, button: Locator): Promise<void> {
  for (let i = 0; i < 150; i++) {
    await win.keyboard.press('Tab');
    if (await button.evaluate((el) => document.activeElement === el)) return;
  }
  throw new Error('The mode switch was not reached with Tab');
}

test('Space stays Next on a Tab-focused mute switch and never switches Simple/Pro Mode, even twice (lead 2’s item 1 exceptions)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1410, height: 900 });
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await slidesOf(win, KIRTAN).nth(1).click();
  await expect(live(win)).toContainText(`${KIRTAN} · slide 2 of 5`);

  const mute = win.getByTestId('sound-mute-audio');
  await expect(mute).toHaveAttribute('aria-checked', 'true');
  await letGo(win);
  await tabTo(win, (id) => id === 'sound-mute-audio');
  await expect(mute).toBeFocused();
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 3 of 5`);
  await expect(mute).toHaveAttribute('aria-checked', 'true');

  const toSimple = win.getByRole('button', { name: 'Simple Mode', exact: true });
  await tabToButton(win, toSimple);
  await win.keyboard.press('Space');
  await win.keyboard.press('Space');
  await expect(live(win)).toContainText(`${KIRTAN} · slide 5 of 5`);
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(toSimple).toBeFocused();
  // Enter twice still switches. On the way back Space twice must keep Simple Mode too.
  await win.keyboard.press('Enter');
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const toPro = win.getByTestId('simple-leave');
  await tabToButton(win, toPro);
  await win.keyboard.press('Space');
  await win.keyboard.press('Space');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(toPro).toBeFocused();
  await app.close();
});

test('the keys sheet names the key held to see the buttons’ keys (a25 item 24)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await letGo(win);
  await win.keyboard.press('Shift+Slash');
  const sheet = win.getByTestId('keys-sheet');
  await expect(sheet).toBeVisible();
  const hold = sheet.getByTestId('keys-hold');
  await expect(hold).toContainText('See the buttons’ keys while you hold it');
  await expect(hold.locator('kbd')).toHaveText(process.platform === 'darwin' ? '⌥' : 'Alt');
  await expect(hold).toContainText('let go of it, then press the key');
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await app.close();
});
