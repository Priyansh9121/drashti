import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

const isOutput = (url: string) => url.includes('output.html');

test("an output on the operator's display needs consent, and Uncover gets the controls back", async () => {
  const { app } = await launchApp();
  const op = await app.firstWindow();
  await expect(op.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
  const operatorDisplay = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
    return win ? screen.getDisplayMatching(win.getBounds()).id : -1;
  });
  const openOutputs = () => app.windows().filter((w) => !w.isClosed() && isOutput(w.url())).length;
  const shortcutRegistered = () =>
    app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+U'));
  const sleepBlocked = () =>
    app.evaluate(
      () =>
        (globalThis as unknown as { drashtiDiagnostics: { sleepGuard: { held: boolean } } })
          .drashtiDiagnostics.sleepGuard.held,
    );

  await op.getByRole('button', { name: 'Screens', exact: true }).click();
  await op.getByLabel('New group name').fill('Main Hall');
  await op.getByRole('button', { name: 'Add group' }).click();
  const row = op.locator(`[data-testid="display-row"][data-display-id="${operatorDisplay}"]`);
  const confirm = op.getByTestId('cover-confirm');

  // Asking first, saying plainly what happens and how to get back.
  await row.getByRole('button', { name: 'Use this display' }).click();
  await expect(confirm).toContainText('Cover the Drashti controls?');
  await expect(confirm).toContainText('cover them completely');
  await expect(confirm).toContainText(process.platform === 'darwin' ? '⌘⇧U' : 'Ctrl+Shift+U');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(op.getByTestId('screen-row')).toHaveCount(0);
  expect(openOutputs()).toBe(0);
  expect(await sleepBlocked()).toBe(false);

  // Agreeing opens the output over the controls; the uncover shortcut is now registered system-wide.
  await row.getByRole('button', { name: 'Use this display' }).click();
  // Listen before agreeing: the window can open before a listener added afterwards would see it.
  const outputOpened = app.waitForEvent('window', { predicate: (w) => isOutput(w.url()) });
  await confirm.getByRole('button', { name: 'Cover the controls' }).click();
  await outputOpened;
  await expect(op.getByTestId('screen-state')).toContainText('Showing');
  await expect.poll(shortcutRegistered).toBe(true);
  // While an output shows, the display may not sleep.
  await expect.poll(sleepBlocked).toBe(true);
  // macOS: opening an output must not hide Drashti's Dock icon (and with it the menu bar).
  if (process.platform === 'darwin') {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.dock?.isVisible())).toBe(true);
  }

  // The uncover key turns that output off, and it stays off.
  await op.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+U' : 'Control+Shift+U');
  await expect(op.getByTestId('screen-state')).toHaveText('Off');
  await expect.poll(openOutputs).toBe(0);
  await expect.poll(shortcutRegistered).toBe(false);
  await expect.poll(sleepBlocked).toBe(false);

  // Switching it back on asks again.
  // The box stays unticked until the operator agrees.
  await op.getByLabel('On', { exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cover the controls' }).click();
  await expect(op.getByTestId('screen-state')).toContainText('Showing');
  await expect.poll(openOutputs).toBe(1);

  // The Window menu item does the same as the key.
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('uncover-controls')?.click();
  });
  await expect(op.getByTestId('screen-state')).toHaveText('Off');
  await expect.poll(openOutputs).toBe(0);
  await app.close();
});
