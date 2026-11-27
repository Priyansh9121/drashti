import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Help › Show Help (alpha.24, helpmenu): the status bar's Help switch (help-switch.spec.ts) in the menu bar too, under
 * Guides…, ticked while Help is on, in step with the switch both ways, in Pro and Simple Mode; remembered on this
 * computer as the switch is, so a new start ticks it as it was left.
 */

/** The Help menu's items, in order, by their ids (null for a line between them). */
const helpItems = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()?.items.find((i) => i.role === 'help');
    return (help?.submenu?.items ?? []).map((i) => (i.type === 'separator' ? null : i.id));
  });

/** Help › Show Help as the menu bar has it now (null: not there). */
const menuHelp = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('help-switch');
    return item ? { label: item.label, type: item.type, checked: item.checked } : null;
  });

const ticked = async (app: ElectronApplication) => (await menuHelp(app))?.checked ?? null;

test('Help › Show Help: under Guides…, ticked while the status bar’s Help switch is on, in step both ways in Pro and Simple Mode, and as left at a new start', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const help = win.getByTestId('help-toggle');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  expect((await helpItems(app)).slice(0, 3)).toEqual(['manual', 'guides', 'help-switch']);
  expect(await menuHelp(app)).toEqual({ label: 'Show Help', type: 'checkbox', checked: false });

  // On from the menu: the status bar's switch pressed, every ? shown, and the item ticked.
  await chooseMenuItem(app, 'help-switch');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('what-is-this-live')).toBeVisible();
  await expect.poll(() => ticked(app), { message: 'Pro Mode: ticked once Help is on' }).toBe(true);
  // Off from the switch: no ?, and the item unticked.
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
  await expect.poll(() => ticked(app), { message: 'Pro Mode: unticked once Help is off' }).toBe(false);
  // On from the menu again, and left on.
  await chooseMenuItem(app, 'help-switch');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ticked(app)).toBe(true);
  await app.close();

  // A new start: Help as it was left, and the item ticked as the window says.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await win2.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win2);
  const help2 = win2.getByTestId('help-toggle');
  await expect(help2).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ticked(again.app), { message: 'a new start: ticked as Help was left' }).toBe(true);

  // Simple Mode: the same item and the same switch, in step both ways.
  await chooseMenuItem(again.app, 'switch-mode');
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  expect((await helpItems(again.app)).slice(0, 3)).toEqual(['manual', 'guides', 'help-switch']);
  await expect.poll(() => ticked(again.app), { message: 'Simple Mode: still ticked' }).toBe(true);
  await chooseMenuItem(again.app, 'help-switch');
  await expect(help2).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => ticked(again.app), { message: 'Simple Mode: unticked from the menu' }).toBe(false);
  await help2.click();
  await expect(help2).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ticked(again.app), { message: 'Simple Mode: ticked from the switch' }).toBe(true);
  await again.app.close();
});
