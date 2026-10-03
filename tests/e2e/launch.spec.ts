import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, type PageGlobals } from './helpers';

test('opens a sandboxed, context-isolated operator window', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
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

  // The OS reports every window's renderer process as sandboxed (macOS and Windows): the operator
  // window and the hidden audio player.
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const sandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      page: w.webContents.getURL().split('/').pop(),
      sandboxed: electronApp.getAppMetrics().find((m) => m.pid === w.webContents.getOSProcessId())?.sandboxed,
    })),
  );
  expect(sandboxed.map((w) => w.page).sort()).toEqual(['audio.html', 'index.html']);
  if (process.platform === 'darwin' || process.platform === 'win32')
    for (const w of sandboxed) expect(w, w.page).toMatchObject({ sandboxed: true });

  await app.close();
});

test('the operator window reaches the show engine through the typed bridge', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await expect(win.getByTestId('live-text')).toHaveText('Nothing live');

  // The first Look went live as Drashti started: the revision after that is the next one.
  const { rev } = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
  const result = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'toggleBlackout' }),
  );
  expect(result).toEqual({ ok: true, changed: true, rev: rev + 1 });
  await expect(win.getByTestId('blackout-button')).toHaveAttribute('aria-pressed', 'true');

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
