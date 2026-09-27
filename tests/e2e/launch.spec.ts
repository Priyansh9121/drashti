import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('opens a sandboxed, context-isolated operator window', async () => {
  const { app } = await launchApp();
  const win = await app.firstWindow();
  await expect(win).toHaveTitle('Drashti');
  await expect(win.getByTestId('app-info')).toContainText('Electron');

  // No Node in the page; the bridge exists, which contextBridge only allows with context isolation.
  const page = await win.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridge: typeof (globalThis as { drashti?: unknown }).drashti,
  }));
  expect(page).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });

  // The OS reports the renderer process as sandboxed (macOS and Windows).
  const sandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
    return electronApp.getAppMetrics().find((m) => m.pid === pid)?.sandboxed;
  });
  if (process.platform === 'darwin' || process.platform === 'win32') expect(sandboxed).toBe(true);

  await app.close();
});
