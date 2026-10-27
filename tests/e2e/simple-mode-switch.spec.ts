import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Simple Mode, a way of working with no PIN (Session 54, E5: "remove admin/operator logic completely"; these
 * are the roles spec's Simple Mode parts, kept when roles went). In by the header's Simple Mode, at once; out by
 * its own Switch to Pro Mode… (or the View menu) and the word pro, typed on purpose, as Session 20 made it: a PIN
 * is no way out, only another wrong word. Nothing asks for a PIN anywhere, and the header has no button saying
 * who is at the controls. In CI's window, about 1024 × 645 (Session 51), in Pro Mode and in Simple Mode: the
 * header, Simple Mode's screen and its way out fit and pass the accessibility checks. Placeholder words only.
 */

/** A PIN as alpha.12's roles took one: made up, and only ever a wrong word now. */
const OLD_PIN = '481526';

const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** Nothing asks for a PIN, and nothing says who is at the controls. */
async function noRoles(win: Page): Promise<void> {
  for (const id of ['role-chip', 'admin-pin', 'roles-dialog', 'leave-simple-pin'])
    await expect(win.getByTestId(id), id).toHaveCount(0);
}

test('Simple Mode in by the header’s button and out by its own with the word pro, never a PIN; no role button in the header', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  // Pro Mode, as every clean start: nothing typed, nothing asked.
  expect(await modeOf(win)).toBe('pro');
  const header = win.getByTestId('app-header');
  await noRoles(win);

  // In: one press, nothing asked.
  await header.getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await modeOf(win)).toBe('simple');
  await noRoles(win);

  // Out: its own Switch to Pro Mode… asks for the word. A PIN, as alpha.12 took one, is a wrong word.
  const dialog = win.getByTestId('leave-simple');
  await win.getByTestId('simple-leave').click();
  await expect(dialog).toContainText('Type pro to switch');
  await expect(dialog).not.toContainText('PIN');
  await dialog.getByRole('textbox').fill(OLD_PIN);
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(dialog).toContainText('Type pro to switch to Pro Mode.');
  expect(await modeOf(win)).toBe('simple');
  // The main process takes none either, whatever a page sends.
  expect(
    await win.evaluate((pin) => (globalThis as PageGlobals).drashti.app.setMode('pro', pin), OLD_PIN),
  ).toEqual({ ok: false, message: 'Type pro to switch to Pro Mode.' });
  expect(await modeOf(win)).toBe('simple');
  await dialog.getByRole('textbox').fill('pro');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');

  // The View menu's way, the same: Switch to Simple Mode at once, Switch to Pro Mode… with the word.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await chooseMenuItem(app, 'switch-mode');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('PRO');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect.poll(() => modeOf(win)).toBe('pro');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await noRoles(win);
  await app.close();
});

test('in CI’s window (1024 × 645): Pro Mode’s header and Simple Mode’s screen and way out fit, and pass the accessibility checks', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  // Pro Mode: the header, every button's words in it, and no role button among them.
  const header = win.getByTestId('app-header');
  await expectFits(header, 'the header in Pro Mode at 1024 × 645');
  for (const words of ['Themes', 'Stream', 'Phones', 'Screens', 'Simple Mode'])
    await expect(header.getByRole('button', { name: words, exact: true })).toBeVisible();
  await noRoles(win);
  await expectNoSeriousA11yIssues(win, 'the header in Pro Mode at 1024 × 645', '[data-testid="app-header"]');

  // Simple Mode: its screen, with its way out at the top, in sight.
  await header.getByRole('button', { name: 'Simple Mode', exact: true }).click();
  const simple = win.getByTestId('simple-mode');
  await expectFits(simple, 'Simple Mode at 1024 × 645');
  await expect(win.getByTestId('simple-leave')).toBeInViewport({ ratio: 1 });
  await noRoles(win);
  await expectNoSeriousA11yIssues(win, 'Simple Mode at 1024 × 645');

  // Its way out asks for the word, in a dialog that fits.
  await win.getByTestId('simple-leave').click();
  const dialog = win.getByTestId('leave-simple');
  await expectFits(dialog, 'Switch to Pro Mode? at 1024 × 645');
  await expect(dialog).not.toContainText('PIN');
  await expectNoSeriousA11yIssues(win, 'Switch to Pro Mode? at 1024 × 645');
  await dialog.getByRole('textbox').fill('pro');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(simple).toHaveCount(0);
  await expectFits(header, 'the header in Pro Mode again at 1024 × 645');
  await app.close();
});
