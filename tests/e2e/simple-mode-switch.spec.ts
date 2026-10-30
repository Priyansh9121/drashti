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
 * are the roles spec's Simple Mode parts, kept when roles went). In by the header's Simple Mode, at once; out by a
 * double-click on its own Pro Mode (Session 55, Part 18: the owner's answer to question 12, changed on 29 Oct 2026,
 * replacing the word pro typed since Session 20), with nothing typed and nothing asked: one click is not enough, and
 * from the keyboard it takes two presses of Enter; View › Switch to Pro Mode switches at once too. Nothing
 * asks for a PIN anywhere, and the header has no button saying who is at the controls. In CI's window, about
 * 1024 × 645 (Session 51), in Pro Mode and in Simple Mode: the header, Simple Mode's screen and its way out fit and
 * pass the accessibility checks. Placeholder words only.
 */

/** A PIN as alpha.12's roles took one: made up, and asked for nowhere. */
const OLD_PIN = '481526';

const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** Nothing asks for a PIN, and nothing says who is at the controls. */
async function noRoles(win: Page): Promise<void> {
  for (const id of ['role-chip', 'admin-pin', 'roles-dialog', 'leave-simple-pin'])
    await expect(win.getByTestId(id), id).toHaveCount(0);
}

test('Simple Mode in by the header’s button, out by a double-click on Pro Mode with nothing typed (one click is not enough; the View menu at once), never a PIN; no role button in the header', async () => {
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

  // Out: one click on Pro Mode says to double-click it, and stays; a double-click goes, with no question and no word.
  const pro = win.getByTestId('simple-leave');
  await expect(pro).toHaveAccessibleName(/^Pro Mode/u);
  await pro.click();
  await expect(win.getByTestId('operator-notice')).toContainText('Double-click Pro Mode');
  expect(await modeOf(win)).toBe('simple');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await pro.dblclick();
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await noRoles(win);

  // The main process asks for nothing either: a request is enough, whatever a page adds to it (a PIN is no part of it).
  await header.getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(
    await win.evaluate(
      (pin) =>
        (
          (globalThis as PageGlobals).drashti.app.setMode as unknown as (
            mode: string,
            extra: string,
          ) => Promise<unknown>
        )('pro', pin),
      OLD_PIN,
    ),
  ).toEqual({ ok: true, mode: 'pro' });
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // By the keyboard alone (Enter twice; Space is Next everywhere in the window): simple-mode.spec.ts.

  // The View menu's way: Switch to Simple Mode, then Switch to Pro Mode, each at once.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const label = await app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('switch-mode')?.label ?? '',
  );
  expect(label).toBe('Switch to Pro Mode');
  await chooseMenuItem(app, 'switch-mode');
  await expect.poll(() => modeOf(win)).toBe('pro');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
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
  for (const words of ['Stream', 'Phones', 'Screens', 'Simple Mode'])
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

  // Its way out asks nothing: a double-click, and the header of Pro Mode fits again.
  await win.getByTestId('simple-leave').dblclick();
  await expect(simple).toHaveCount(0);
  await expectFits(header, 'the header in Pro Mode again at 1024 × 645');
  await app.close();
});
