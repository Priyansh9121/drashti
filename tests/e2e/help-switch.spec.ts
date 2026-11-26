import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, holdStill, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Help on demand (alpha.24, the owner's "we also want a really innovative and non-congusted UI"): the status bar's Help
 * switch, where its ? was, is off at a first start. Off, no ? is drawn anywhere (so none is a Tab stop) and the keys
 * beside the buttons' words are hidden to the eye, each button still read out with its key; Alt (Option on a Mac) held
 * on its own shows the keys while it is held, and a look at them never gives Windows' menu bar the keyboard. On, every ?
 * and every key shows as before. It is remembered on this computer. Simple Mode the same, with no ? of its own.
 */

/** Whether a key is where the eye sees it (hidden to the eye it is a box of 1 px, read out all the same). */
const seen = (key: Locator) => key.evaluate((k) => k.getBoundingClientRect().width > 1);

/** Every ? in the window. */
const asks = (win: Page) => win.locator('[data-what-is-this]');

/** Hold Alt for a look at the keys (as long as an operator does: past the half second that makes it a look). */
async function lookWithAlt(win: Page, key: Locator): Promise<void> {
  const focused = () => win.evaluate(() => document.hasFocus());
  const before = await focused();
  await win.keyboard.down('Alt');
  await expect.poll(() => seen(key), { message: 'the key shown while Alt is held' }).toBe(true);
  await holdStill(
    async () => (await seen(key)) && (await asks(win).count()) === 0,
    600,
    'Alt held for a look: the keys stay, and no ? comes with them',
  );
  await win.keyboard.up('Alt');
  await expect.poll(() => seen(key), { message: 'the key hidden once Alt is let go' }).toBe(false);
  // The window keeps the keyboard as it had it: no menu bar took it (Windows).
  expect(await focused()).toBe(before);
}

test('Pro Mode: Help off at a first start: no ?, the keys hidden but read out, Alt held shows them; Help on shows every ? and key, remembered on this computer', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const help = win
    .getByRole('contentinfo', { name: 'Status' })
    .getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('data-testid', 'help-toggle');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  // No ? anywhere: there were 12 in sight at this size until alpha.24.
  await expect(asks(win)).toHaveCount(0);
  const next = win.getByTestId('show-next');
  const nextKey = next.locator('kbd');
  const clearAll = win.getByTestId('layer-bar').getByRole('button', { name: /^Clear all/u });
  const clearAllKey = clearAll.locator('kbd');
  await expect.poll(() => seen(nextKey)).toBe(false);
  await expect.poll(() => seen(clearAllKey)).toBe(false);
  // Read out with its key all the same.
  await expect(next).toHaveAccessibleName(/^Next\s*→$/u);
  await expect(clearAll).toHaveAccessibleName(/^Clear all\s*F1$/u);
  await expectNoSeriousA11yIssues(win, 'Help off');

  await lookWithAlt(win, nextKey);
  // Alt with another key is a shortcut, not Alt on its own: the keys hide.
  await win.keyboard.down('Alt');
  await expect.poll(() => seen(clearAllKey)).toBe(true);
  await win.keyboard.down('Shift');
  await expect.poll(() => seen(clearAllKey)).toBe(false);
  await win.keyboard.up('Shift');
  await win.keyboard.up('Alt');

  // Help on: every ? and key as before.
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('what-is-this-live')).toBeVisible();
  await expect(win.getByTestId('what-is-this-statusbar')).toBeVisible();
  await expect(win.getByTestId('what-is-this-controls')).toBeVisible();
  // In CI's 1024 × 645 the switch is its round ? alone, in the ?'s own 24 px, and the bar's own ? goes (as the
  // header's do below 1280 px), so the bar holds no more than before: nothing runs past the window.
  await win.setViewportSize({ width: 1024, height: 645 });
  await expect(win.getByTestId('what-is-this-statusbar')).toBeHidden();
  await expect.poll(async () => (await help.boundingBox())?.width).toBe(24);
  await expect(help).toHaveAccessibleName('Help');
  await expect
    .poll(() => win.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      message: 'the page does not scroll sideways at 1024 × 645',
    })
    .toBe(true);
  await win.setViewportSize({ width: 1280, height: 720 });
  await expect(win.getByTestId('what-is-this-statusbar')).toBeVisible();
  await expect.poll(() => seen(nextKey)).toBe(true);
  await expect.poll(() => seen(clearAllKey)).toBe(true);
  await expect(next).toHaveAccessibleName(/^Next\s*→$/u);
  await expect(clearAll).toHaveAccessibleName(/^Clear all\s*F1$/u);
  // A ? opens its words as before.
  await win.getByTestId('what-is-this-live').click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Help on, a ? open');
  // Help off, by the keyboard: the card and every ? go, the keys hide; on again, the card is not open again.
  await help.focus();
  await win.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(card).toHaveCount(0);
  await expect(asks(win)).toHaveCount(0);
  await expect.poll(() => seen(nextKey)).toBe(false);
  await win.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('what-is-this-live')).toBeVisible();
  await expect(card).toHaveCount(0);
  await app.close();

  // Remembered on this computer: on after a new start, and off again once turned off.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await win2.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win2);
  const help2 = win2.getByTestId('help-toggle');
  await expect(help2).toHaveAttribute('aria-pressed', 'true');
  await expect(win2.getByTestId('what-is-this-live')).toBeVisible();
  await help2.click();
  await expect(asks(win2)).toHaveCount(0);
  await again.app.close();
  const third = await relaunchApp(userData);
  const win3 = await operatorPage(third.app);
  await operatorReady(win3);
  await expect(win3.getByTestId('help-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(asks(win3)).toHaveCount(0);
  await third.app.close();
});

test('Simple Mode: the keys hidden at rest, Alt held shows them, Help on shows them; never a ?', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const help = win
    .getByRole('contentinfo', { name: 'Status' })
    .getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  const blackout = win.getByTestId('simple-blackout');
  const blackoutKey = blackout.locator('kbd');
  const nextKey = win.getByTestId('show-next').locator('kbd');
  await expect.poll(() => seen(blackoutKey)).toBe(false);
  await expect.poll(() => seen(nextKey)).toBe(false);
  await expect(blackout).toHaveAccessibleName(/^Black-out\s*B$/u);
  await lookWithAlt(win, blackoutKey);
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => seen(blackoutKey)).toBe(true);
  await expect.poll(() => seen(nextKey)).toBe(true);
  await expect(asks(win)).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'Simple Mode, Help on');
  await app.close();
});
