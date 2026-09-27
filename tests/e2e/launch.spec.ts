import { expect, test } from '@playwright/test';
import { launchApp, type PageGlobals } from './helpers';

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
    ipcRenderer: typeof (globalThis as { ipcRenderer?: unknown }).ipcRenderer,
  }));
  expect(page).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: 'object',
    ipcRenderer: 'undefined',
  });

  // The OS reports the renderer process as sandboxed (macOS and Windows).
  const sandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
    return electronApp.getAppMetrics().find((m) => m.pid === pid)?.sandboxed;
  });
  if (process.platform === 'darwin' || process.platform === 'win32') expect(sandboxed).toBe(true);

  await app.close();
});

test('the operator window reaches the show engine through the typed bridge', async () => {
  const { app } = await launchApp();
  const win = await app.firstWindow();
  await expect(win.getByTestId('engine-status')).toHaveText('Engine revision 0');

  const result = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'toggleBlackout' }),
  );
  expect(result).toEqual({ ok: true, changed: true, rev: 1 });
  await expect(win.getByTestId('engine-status')).toHaveText('Engine revision 1 · black-out on');

  // Invalid input is rejected by the main process, not trusted.
  const bad = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'goLive',
      presentationId: '',
      slideIndex: -1,
    }),
  );
  expect(bad).toMatchObject({ ok: false, error: 'invalid-command' });
  await app.close();
});
