import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { launchApp } from './helpers';

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

test('screen groups: assign a display, open an output, restore it after a restart', async () => {
  const first = await launchApp();
  let app = first.app;
  const win = await app.firstWindow();

  // Displays are listed with the resolution and refresh rate the OS reports.
  await win.getByRole('button', { name: 'Screens' }).click();
  const displayRow = win.getByTestId('display-row').first();
  await expect(displayRow).toContainText(/\d+ × \d+ · [\d.]+ Hz/);

  // Create a group and give it the first display.
  await win.getByLabel('New group name').fill('Main Hall');
  await win.getByRole('button', { name: 'Add group' }).click();
  await expect(win.getByTestId('screen-group')).toHaveCount(1);
  await displayRow.getByRole('button', { name: 'Use this display' }).click();
  await expect(win.getByTestId('screen-state')).toContainText('Showing');

  // An output window opens on that display, in its own renderer process.
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-screen', /.+/);
  const facts = await app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows();
    const out = all.find((w) => w.webContents.getURL().includes('output.html'));
    const op = all.find((w) => !w.webContents.getURL().includes('output.html'));
    if (!out || !op) return null;
    const display = screen.getDisplayMatching(out.getBounds());
    return {
      outputPid: out.webContents.getOSProcessId(),
      operatorPid: op.webContents.getOSProcessId(),
      bounds: out.getBounds(),
      displayBounds: display.bounds,
      alwaysOnTop: out.isAlwaysOnTop(),
      focusable: out.isFocusable(),
    };
  });
  expect(facts).not.toBeNull();
  expect(facts?.outputPid).not.toBe(facts?.operatorPid);
  expect(facts?.bounds).toEqual(facts?.displayBounds);
  expect(facts?.alwaysOnTop).toBe(true);
  expect(facts?.focusable).toBe(false);

  // Set a custom canvas size.
  const width = win.getByLabel('Canvas width');
  await width.fill('1536');
  await width.press('Enter');
  await expect(width).toHaveValue('1536');

  await app.close();

  // Restart with the same data folder: the output comes back by itself.
  const second = await launchApp({}, first.userData);
  app = second.app;
  const out2 = await outputPage(app);
  await expect(out2.getByTestId('output-root')).toHaveAttribute('data-screen', /.+/);
  const win2 = await app.firstWindow();
  await win2.getByRole('button', { name: 'Screens' }).click();
  await expect(win2.getByLabel('Canvas width')).toHaveValue('1536');
  await expect(win2.getByTestId('screen-state')).toContainText('Showing');
  await app.close();

  // Pretend the display is gone: point the screen at one that is not connected.
  const db = new Database(join(first.userData, 'drashti.sqlite'));
  db.prepare('UPDATE screens SET display_key = ?').run(
    JSON.stringify({
      id: 987654,
      label: 'Unplugged TV',
      pixelWidth: 1234,
      pixelHeight: 567,
      x: 99999,
      y: 0,
      internal: false,
    }),
  );
  db.close();

  const third = await launchApp({}, first.userData);
  app = third.app;
  const win3 = await app.firstWindow();
  await win3.getByRole('button', { name: 'Screens' }).click();
  await expect(win3.getByTestId('screen-state')).toHaveText('Display not connected');
  expect(app.windows().some((w) => w.url().includes('output.html'))).toBe(false);
  await app.close();
});
