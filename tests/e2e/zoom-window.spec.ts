import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
  relaunchApp,
  windowShowing,
} from './helpers';

/*
 * Window for Zoom… (Session 48): the stream's picture, exactly, in a normal window of its own titled
 * "Drashti for Zoom", for Zoom's Share Screen. Tests never open Zoom: they look at the window itself. Only a
 * person can check sharing it in a real Zoom meeting, and how it keeps 16:9 when dragged by its edge
 * (assister/session-48-final-report.md).
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };

const isZoom = (p: Page) => p.url().includes('zoom.html');

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

function streamStatus(win: Page) {
  return win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
}

/** The colour in the middle of the window for Zoom's picture, as [r, g, b] (null before a frame). */
function middle(zoom: Page): Promise<number[] | null> {
  return zoom.evaluate(() => {
    const v = document.querySelector('video');
    if (!v || v.videoWidth === 0) return null;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(v, 0, 0, 32, 18);
    return [...g.getImageData(16, 9, 1, 1).data.slice(0, 3)];
  });
}

const near = (rgb: number[] | null, want: readonly number[]) =>
  rgb?.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= 12) ?? false;

/** The window for Zoom's own BrowserWindow, as the main process sees it. */
function zoomWindow(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && x.webContents.getURL().includes('zoom.html'),
    );
    if (!w) return null;
    return {
      title: w.getTitle(),
      fullScreenable: w.isFullScreenable(),
      maximizable: w.isMaximizable(),
      onTop: w.isAlwaysOnTop(),
      fullScreen: w.isFullScreen(),
      bounds: w.getContentBounds(),
    };
  });
}

test('Window for Zoom… shows exactly the stream’s picture, off air; it never takes over, remembers its place, and closing it changes nothing', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  // The stream's picture: its Slides layout over a colour, with nothing live on air.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#2e8b57' } });

  await chooseMenuItem(app, 'zoom-window');
  const zoom = await windowShowing(app, isZoom, 'the window for Zoom');
  await expect(zoom).toHaveTitle('Drashti for Zoom');
  // The Program opened for it, as for the preview: off air and not recording.
  await expect.poll(async () => (await streamStatus(win)).programOn, { timeout: 30_000 }).toBe(true);
  const status = await streamStatus(win);
  expect([status.live.state, status.recording.state]).toEqual(['off', 'off']);

  // The picture is the Program's own page, at the stream's size: a capture of a page, never a camera.
  const picture = zoom.getByTestId('zoom-picture');
  await expect(picture).toHaveAttribute('data-program', '1920x1080', { timeout: 30_000 });
  await expect.poll(async () => near(await middle(zoom), [46, 139, 87]), { timeout: 30_000 }).toBe(true);
  const track = await zoom.evaluate(() => {
    const s = document.querySelector('video')?.srcObject;
    const t = s instanceof MediaStream ? s.getVideoTracks()[0]?.getSettings() : undefined;
    return {
      surface: t?.displaySurface,
      device: t?.deviceId?.split('://')[0],
      audio: s instanceof MediaStream ? s.getAudioTracks().length : -1,
    };
  });
  expect(track).toEqual({ surface: 'browser', device: 'web-contents-media-stream', audio: 0 });
  // It follows the stream as it changes.
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#8b2e5a' } });
  await expect.poll(async () => near(await middle(zoom), [139, 46, 90]), { timeout: 15_000 }).toBe(true);
  // Nothing of Drashti's own over the picture: no words, no buttons.
  expect(await zoom.evaluate(() => document.body.innerText.trim())).toBe('');
  await expect(zoom.locator('button, input, a, [role="button"]')).toHaveCount(0);

  // It never takes over: no full screen, never on top, never maximised over a display. To begin, 1280 × 720,
  // or the controls' display's width at 16:9 when that is narrower (CI's displays are 1024 wide, Session 49).
  const first = await app.evaluate(({ BrowserWindow, screen }) => {
    const operator = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
    const area = (operator ? screen.getDisplayMatching(operator.getBounds()) : screen.getPrimaryDisplay())
      .workArea;
    const width = Math.min(1280, area.width);
    return { width, height: Math.round((width * 9) / 16) };
  });
  expect(await zoomWindow(app)).toMatchObject({
    title: 'Drashti for Zoom',
    fullScreenable: false,
    maximizable: false,
    onTop: false,
    fullScreen: false,
    bounds: first,
  });

  // Moved and closed: the show and the stream are as they were, and the Program closes (nothing needs it).
  // The new place fits a 1024 × 768 display.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('zoom.html'));
    w?.setContentBounds({ x: 120, y: 140, width: 640, height: 360 });
    w?.close();
  });
  await expect.poll(async () => (await streamStatus(win)).programOn, { timeout: 15_000 }).toBe(false);
  const after = await streamStatus(win);
  expect([after.live.state, after.recording.state, after.layout]).toEqual(['off', 'off', 'slides']);
  expect(
    await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
    ),
  ).toEqual({ kind: 'color', color: '#8b2e5a' });

  // Opened again, from the Stream panel this time: where it was, at the size it had.
  await win.getByTestId('open-stream').click();
  await win.getByTestId('open-zoom-window').click();
  await windowShowing(app, isZoom, 'the window for Zoom, again');
  await expect
    .poll(async () => (await zoomWindow(app))?.bounds)
    .toEqual({ x: 120, y: 140, width: 640, height: 360 });
  // One window only: pressed again, it is the same window, brought forward.
  await win.getByTestId('open-zoom-window').click();
  await holdStill(
    async () =>
      (await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((x) => x.webContents.getURL().includes('zoom.html')).length,
      )) === 1,
    1000,
    'pressed again, no second window for Zoom opens',
  );
  await app.close();
});

test('Simple Mode has no Window for Zoom…, and the window is not opened again after a restart', async () => {
  test.setTimeout(120_000);
  const first = await launchApp(FAKE);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await chooseMenuItem(first.app, 'zoom-window');
  await windowShowing(first.app, isZoom, 'the window for Zoom');
  await first.app.close();

  // Started again: the operator's window, and no window for Zoom.
  const second = await relaunchApp(first.userData, FAKE);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await holdStill(async () => (await zoomWindow(second.app)) === null, 2000, 'not opened again by itself');

  // Simple Mode: not in the View menu, and refused from the window too.
  await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  expect(
    await second.app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('zoom-window') ?? null,
    ),
  ).toBeNull();
  await win2.evaluate(() => (globalThis as PageGlobals).drashti.zoom.open());
  await holdStill(async () => (await zoomWindow(second.app)) === null, 1000, 'Simple Mode opens none');
  await second.app.close();
});
