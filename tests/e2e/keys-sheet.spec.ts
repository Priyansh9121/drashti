import { expect, test } from '@playwright/test';
import { KEY_GROUPS, KEYMAP } from '../../src/shared/keymap';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * The keys sheet (Session 25): Help > Keyboard Shortcuts…, or ? when no field has the focus, in Pro
 * Mode only. It lists every key in KEYMAP, grouped by what the operator is doing, as this computer
 * writes them, and says the keys may change after the setup day.
 */

const menuHas = (app: Awaited<ReturnType<typeof launchApp>>['app'], id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId) != null, id);

test('the keys sheet opens from the Help menu and with ?, lists every key, and is Pro Mode’s only', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const sheet = win.getByTestId('keys-sheet');

  // Help > Keyboard Shortcuts…
  await chooseMenuItem(app, 'keyboard-shortcuts');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('keys-group')).toHaveCount(KEY_GROUPS.length);
  for (const binding of KEYMAP) await expect(sheet).toContainText(binding.label);
  await expect(sheet.getByTestId('keys-provisional')).toContainText('may change after the setup day');
  // As this computer writes them: Search is ⌘F on a Mac, Ctrl+F on Windows.
  await expect(sheet).toContainText(process.platform === 'darwin' ? '⌘F' : 'Ctrl+F');
  await expectNoSeriousA11yIssues(win, 'the keys sheet');
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // ? with no field chosen opens it, and ? closes it again.
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toBeVisible();
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toHaveCount(0);
  // In a field, ? is a character: no sheet.
  const search = win.getByTestId('library-search');
  await search.focus();
  await win.keyboard.type('?');
  await expect(search).toHaveValue('?');
  await expect(sheet).toHaveCount(0);
  await search.fill('');

  // Simple Mode keeps its key line: no menu item, and ? does nothing.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await menuHas(app, 'keyboard-shortcuts')).toBe(false);
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toHaveCount(0);
  await app.close();
});
