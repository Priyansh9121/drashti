import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  killApp,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
  windowShowing,
} from './helpers';

/*
 * Show a Window… (Session 48): another app's window (a Zoom meeting's) live as the hall's background.
 * Seeing other apps' windows needs macOS's Screen Recording, which a test cannot have, and no test may look
 * at the computer's own windows: windows the test opens itself, titled "Placeholder meeting" and showing a
 * moving test pattern, stand in for them (DRASHTI_TEST_WINDOW_STANDIN, src/main/live-window/stand-in-sources.ts).
 * Only a person can check a real Zoom window (assister/session-48-final-report.md).
 */

const STANDIN = { DRASHTI_TEST_WINDOW_STANDIN: '1' };
const MEETING = 'Placeholder meeting';

/** A moving test pattern: blue, with a yellow bar going across, and its name. */
const PATTERN = `<!doctype html><html><head><meta charset="utf-8"><title>${MEETING}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#1d4ed8}#bar{position:absolute;top:35%;left:0;width:20%;height:30%;background:#facc15}p{position:absolute;left:4%;bottom:4%;margin:0;font:32px sans-serif;color:#ffffff}</style></head><body><div id="bar"></div><p>${MEETING}</p><script>let x=0;setInterval(()=>{x=(x+2)%80;document.getElementById('bar').style.left=x+'%'},40)</script></body></html>`;

/** The placeholder meeting, opened in Drashti's own process without taking the focus; its window's id. */
function openPlaceholder(app: ElectronApplication): Promise<number> {
  return app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title: 'Placeholder meeting',
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.showInactive();
    return w.id;
  }, PATTERN);
}

function placeholder(app: ElectronApplication, id: number, act: 'hide' | 'show' | 'close'): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, { id, act }) => {
      const w = BrowserWindow.fromId(id);
      if (!w) return;
      if (act === 'hide') w.hide();
      else if (act === 'show') w.showInactive();
      else w.destroy();
    },
    { id, act },
  );
}

/** Choose the placeholder in Show a Window… (the library's Media tab) and show it on the screens. */
async function showMeeting(win: Page): Promise<void> {
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await win.getByTestId('show-a-window').click();
  const picker = win.getByTestId('window-picker');
  await expect(picker).toBeVisible();
  // Only the placeholder: never the display, nor any of Drashti's own windows (the stand-in lists them all).
  const choices = picker.getByTestId('window-choice');
  await expect(choices).toHaveCount(1);
  await expect(choices).toHaveAttribute('data-name', MEETING);
  await expect(choices.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/u);
  // Nothing goes up until Show on the screens.
  await expect(picker.getByTestId('window-show')).toBeDisabled();
  await choices.click();
  expect(await background(win)).toBeNull();
  await picker.getByTestId('window-show').click();
  await expect(picker).toHaveCount(0);
}

function background(win: Page) {
  return win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );
}

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/**
 * What a page draws of the window: how its capture stands, how many frames its live picture has had (counted
 * from the first look), and the colour near its top left corner (the pattern's blue), from the live picture
 * or, once ended, the kept one.
 */
async function drawn(page: Page): Promise<{ state: string | null; frames: number; blue: boolean }> {
  return page.evaluate(() => {
    const box = document.querySelector('[data-kind="window"]');
    const state = box?.getAttribute('data-window-state') ?? null;
    const video = box?.querySelector('video');
    const kept = box?.querySelector('canvas');
    const seen = window as unknown as { counted?: HTMLVideoElement; frames?: number };
    if (video && seen.counted !== video) {
      seen.counted = video;
      seen.frames = 0;
      const count = () => {
        seen.frames = (seen.frames ?? 0) + 1;
        video.requestVideoFrameCallback(count);
      };
      video.requestVideoFrameCallback(count);
    }
    const frames = seen.frames ?? 0;
    const source = state === 'ended' ? kept : video;
    let blue = false;
    if (source && (source instanceof HTMLCanvasElement ? source.width > 0 : source.videoWidth > 0)) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const g = c.getContext('2d');
      g?.drawImage(source, 0, 0, 64, 36);
      const [r = 0, gr = 0, b = 0] = g ? g.getImageData(4, 4, 1, 1).data : [];
      blue = b > 150 && r < 90 && gr < 140;
    }
    return { state, frames, blue };
  });
}

test('Show a Window… offers only the placeholder, shows it live on the hall, the stage screen, the stream and LIVE; black-out and the logo cover it; Clear all and Put it back', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({
    ...STANDIN,
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    if (!group) throw new Error('no stage group');
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
  });
  const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
  await expect
    .poll(async () => (await Promise.all(outputPages(app).map(roleOf))).sort())
    .toEqual(['audience', 'stage']);
  const [one, two] = outputPages(app);
  if (!one || !two) throw new Error('two screens expected');
  const [hall, stage] = (await roleOf(one)) === 'audience' ? [one, two] : [two, one];
  const meeting = await openPlaceholder(app);
  await showMeeting(win);
  expect(await background(win)).toMatchObject({ kind: 'window', name: MEETING });

  // Live on the hall's screen: the pattern, moving.
  await expect(hall.locator('[data-kind="window"]')).toHaveAttribute('data-window-state', 'live', {
    timeout: 15_000,
  });
  await expect.poll(async () => (await drawn(hall)).blue, { timeout: 10_000 }).toBe(true);
  const framesNow = (await drawn(hall)).frames;
  await expect
    .poll(async () => (await drawn(hall)).frames, { timeout: 10_000 })
    .toBeGreaterThan(framesNow + 3);
  // The stage screen says what is up, as for a video; it never draws it.
  await expect(stage.getByTestId('stage-current')).toContainText('Window on the screens');
  await expect(stage.locator('[data-kind="window"]')).toHaveCount(0);
  // LIVE in the operator window draws it too (a small capture of its own).
  await expect(win.locator('[data-kind="window"]').first()).toHaveAttribute('data-window-state', 'live', {
    timeout: 15_000,
  });

  // The stream: full frame in the Camera layout with no slide up, and in the Slides layout as the hall has it.
  await win.getByTestId('open-stream').click();
  const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
    timeout: 60_000,
  });
  await expect(program.locator('[data-kind="window"]')).toHaveAttribute('data-window-state', 'live', {
    timeout: 15_000,
  });
  await expect.poll(async () => (await drawn(program)).blue, { timeout: 10_000 }).toBe(true);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-layout', 'slides');
  await expect(program.locator('[data-kind="window"]')).toHaveAttribute('data-window-state', 'live', {
    timeout: 15_000,
  });
  await win.getByRole('button', { name: 'Close stream' }).click();

  // Black-out and the logo cover it, and take nothing off.
  await dispatch(win, { type: 'setBlackout', on: true });
  await expect(hall.getByTestId('blackout')).toBeVisible();
  await expect(hall.locator('[data-kind="window"]')).toHaveCount(1);
  await dispatch(win, { type: 'setBlackout', on: false });
  await dispatch(win, {
    type: 'showLogo',
    prop: { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] },
  });
  await expect(hall.getByTestId('logo')).toBeVisible();
  await dispatch(win, { type: 'hideLogo' });
  await expect(hall.getByTestId('logo')).toHaveCount(0);
  expect(await background(win)).toMatchObject({ kind: 'window' });

  // Clear all takes it off; Put it back brings it back while the window is still open.
  await win.getByRole('button', { name: 'Clear all' }).click();
  await expect(hall.locator('[data-kind="window"]')).toHaveCount(0);
  await win.getByTestId('put-back').click();
  await expect(hall.locator('[data-kind="window"]')).toHaveAttribute('data-window-state', 'live', {
    timeout: 15_000,
  });
  await expect.poll(async () => (await drawn(hall)).blue, { timeout: 10_000 }).toBe(true);
  // Its own clear (F3, the background) takes it off too.
  await dispatch(win, { type: 'clearLayer', layer: 'background' });
  await expect(hall.locator('[data-kind="window"]')).toHaveCount(0);
  await placeholder(app, meeting, 'close');
  await app.close();
});

test('a window closed or hidden keeps its last picture on the screens, with a notice and Clear the window', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...STANDIN, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  const meeting = await openPlaceholder(app);
  await showMeeting(win);
  await expect.poll(async () => (await drawn(hall)).blue, { timeout: 15_000 }).toBe(true);
  const notice = win.getByTestId('live-window-gone');
  await expect(notice).toHaveCount(0);

  // Hidden: the screen keeps the picture, and the notice says why; shown again, it goes.
  await placeholder(app, meeting, 'hide');
  await expect(notice).toContainText(`The window “${MEETING}” is closed or hidden`, { timeout: 10_000 });
  expect((await drawn(hall)).blue).toBe(true);
  await placeholder(app, meeting, 'show');
  await expect(notice).toHaveCount(0, { timeout: 10_000 });

  // Closed: its live picture ends; the screen shows the last one kept, never black, and the notice says so.
  await placeholder(app, meeting, 'close');
  await expect(hall.locator('[data-kind="window"]')).toHaveAttribute('data-window-state', 'ended', {
    timeout: 10_000,
  });
  expect((await drawn(hall)).blue).toBe(true);
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await notice.getByTestId('live-window-clear').click();
  await expect(hall.locator('[data-kind="window"]')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(await background(win)).toBeNull();
  await app.close();
});

test('Simple Mode cannot choose a window; a phone names it, can clear it, and cannot choose one', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...STANDIN, ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const meeting = await openPlaceholder(app);
  await showMeeting(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    const p = phone.page;
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const line = p.getByTestId('remote-window');
    await expect(line).toContainText(`A window: ${MEETING}`);
    // A phone's own picture draws nothing for it (the window is on Main's computer), and it has no way to
    // choose one (no engine command names a window: show-engine.test.ts).
    await expect(p.locator('[data-kind="window"]')).toHaveCount(0);
    await line.getByTestId('remote-window-clear').click();
    await expect(line).toHaveCount(0);
    expect(await background(win)).toBeNull();
  } finally {
    await phone.close();
  }

  // Simple Mode: no Show a Window…, and the main process refuses it from the window too.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.liveWindow.list())).toMatchObject({
    ok: false,
  });
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.liveWindow.show('window:1:0')),
  ).toMatchObject({ ok: false });
  expect(await background(win)).toBeNull();
  await placeholder(app, meeting, 'close');
  await app.close();
});

test('after an unexpected stop the window is not put back, and the notice names it', async () => {
  test.setTimeout(150_000);
  const first = await launchApp({ ...STANDIN, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await openPlaceholder(first.app);
  await showMeeting(win);
  await expect
    .poll(() => {
      const file = join(first.userData, 'live-state.json');
      if (!existsSync(file)) return null;
      return (JSON.parse(readFileSync(file, 'utf8')) as { background: { kind?: string } | null }).background
        ?.kind;
    })
    .toBe('window');
  await killApp(first.app);
  const second = await relaunchApp(first.userData, { ...STANDIN, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await expect(win2.getByTestId('recovery-notice')).toContainText(
    `The window “${MEETING}” was on the screens and was not put back, as it may be gone: Show a Window… shows it again.`,
  );
  expect(await background(win2)).toBeNull();
  await second.app.close();
});

test('on a Mac that has not given Screen Recording, the picker says why and opens System Settings', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_WINDOW_STANDIN: 'no-access' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await win.getByTestId('show-a-window').click();
  const why = win.getByTestId('window-permission');
  await expect(why).toContainText('Screen Recording');
  await expect(why).toContainText('nothing goes up until you press Show on the screens');
  await expect(win.getByTestId('window-choice')).toHaveCount(0);
  await expect(win.getByTestId('window-show')).toBeDisabled();
  await why.getByTestId('window-open-settings').click();
  // The stand-in says in the log that System Settings would open (a test never opens it).
  await expect
    .poll(() => readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8'))
    .toContain('Stand-in windows: System Settings would open at Screen Recording');
  await app.close();
});
