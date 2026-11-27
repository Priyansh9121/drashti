import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, operatorReady, useDisplay } from './helpers';

test('every opened show window keeps its sandbox, isolated bridge and strict page policy', async () => {
  const { app } = await launchApp();
  try {
    const operator = await operatorPage(app);
    await operatorReady(operator);
    await operator.getByRole('button', { name: 'Screens', exact: true }).click();
    await operator.getByLabel('New group name').fill('Placeholder hall');
    await operator.getByRole('button', { name: 'Add group' }).click();
    const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
    await useDisplay(operator);
    await opened;
    await operator.getByRole('button', { name: 'Close screens' }).click();
    await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
    await expect.poll(() => app.windows().some((w) => w.url().includes('display-copy.html'))).toBe(true);
    expect(app.windows().length).toBeGreaterThanOrEqual(4);
    for (const page of app.windows()) {
      const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      expect(policy, page.url()).toContain("script-src 'self'");
      expect(policy, page.url()).not.toContain("'unsafe-eval'");
      expect(policy, page.url()).toContain("object-src 'none'");
      expect(policy, page.url()).toContain("base-uri 'none'");
      expect(policy, page.url()).toContain("form-action 'none'");
      const globals = await page.evaluate(() => ({
        require: typeof (globalThis as { require?: unknown }).require,
        process: typeof (globalThis as { process?: unknown }).process,
        bridge: typeof (globalThis as { drashti?: unknown }).drashti,
      }));
      expect(globals, page.url()).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });
    }
    const sandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const metrics = electronApp.getAppMetrics();
      return BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        sandboxed: metrics.find((metric) => metric.pid === window.webContents.getOSProcessId())?.sandboxed,
      }));
    });
    for (const window of sandboxed) expect(window.sandboxed, window.url).toBe(true);
  } finally {
    await app.close();
  }
});

test('renderer navigation cannot replace the operator document; anchors and recovery reload still work', async () => {
  const { app } = await launchApp();
  try {
    const operator = await operatorPage(app);
    await operatorReady(operator);
    const original = operator.url();
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find((w) =>
        new URL(w.webContents.getURL()).pathname.endsWith('/index.html'),
      )?.webContents;
      if (!contents) throw new Error('Operator missing');
      const prevented = new Promise<boolean>((resolve) => {
        contents.once('will-frame-navigate', (event) => resolve(event.defaultPrevented));
      });
      await contents.executeJavaScript("location.assign(new URL('audio.html', location.href).href)");
      return prevented;
    });
    expect(result).toBe(true);
    expect(operator.url()).toBe(original);
    await operator.evaluate(() => {
      location.hash = 'security-placeholder';
    });
    await expect.poll(() => operator.url()).toBe(`${original}#security-placeholder`);
    const recovered = operator.waitForEvent('domcontentloaded');
    await operator.evaluate(() => {
      location.reload();
    });
    await recovered;
    await operatorReady(operator);
    await operator.reload();
    await operatorReady(operator);
    await expect(operator).toHaveTitle('Drashti');
  } finally {
    await app.close();
  }
});

test('window.open is denied and webviews stay inert', async () => {
  const { app } = await launchApp();
  try {
    const operator = await operatorPage(app);
    await operatorReady(operator);
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const result = await operator.evaluate(() => {
      const popup = window.open(new URL('audio.html', location.href).href);
      const view = document.createElement('webview') as HTMLElement & { getWebContentsId?: unknown };
      view.setAttribute('src', new URL('audio.html', location.href).href);
      document.body.append(view);
      const webviewApi = typeof view.getWebContentsId;
      view.remove();
      return { popupDenied: popup === null, webviewApi };
    });
    expect(result).toEqual({ popupDenied: true, webviewApi: 'undefined' });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(before);
  } finally {
    await app.close();
  }
});

test('a new private session has no permissions before Main assigns it a role', async () => {
  const { app } = await launchApp();
  try {
    await operatorReady(await operatorPage(app));
    const states = await app.evaluate(async ({ app: electronApp, BrowserWindow, session }) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const file = path.join(electronApp.getPath('userData'), 'security-placeholder.html');
      fs.writeFileSync(
        file,
        `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'"><title>Placeholder</title>`,
      );
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          session: session.fromPartition('drashti-security-placeholder'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
        },
      });
      try {
        await window.loadFile(file);
        return (await window.webContents.executeJavaScript(`Promise.all(
          ['notifications', 'geolocation', 'camera', 'microphone', 'midi', 'clipboard-read'].map(async (name) =>
            [name, (await navigator.permissions.query({ name })).state])
        )`)) as [string, string][];
      } finally {
        window.destroy();
        fs.unlinkSync(file);
      }
    });
    expect(states).toHaveLength(6);
    for (const [permission, state] of states) expect(state, permission).toBe('denied');
  } finally {
    await app.close();
  }
});
