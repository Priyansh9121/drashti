import { type Locator, type Page, expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  closeLibrary,
  killApp,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  savedLive,
  setUpScreen,
  windowShowing,
} from './helpers';

/*
 * A video input on LIVE and on the stream (Session 50): a camera or capture input on this computer (the video
 * mixer's program out, through its USB output), named in Media's Video inputs and put up with one click as the
 * live background, the slide staying over it. Chromium's fake camera (DRASHTI_TEST_FAKE_DEVICES: a moving test
 * pattern, named "fake_device_0") stands in for it, named "Placeholder input": never a real camera's picture. A
 * test cannot unplug the fake camera: a page is told it was (the computer stops listing it, and its picture
 * ends), and that it was plugged in again.
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
const INPUT = 'Placeholder input';
/** Chromium's fake camera, as the computer names it. */
const DEVICE = 'fake_device_0';

function background(win: Page) {
  return win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );
}

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/** The video's width once it has a frame (0 before). */
const videoWidth = (picture: Locator) =>
  picture.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth);

/**
 * Name the fake camera "Placeholder input" with Add a Video Input… (the library's Media tab): only once it is
 * chosen and named does Add to Media keep it, and nothing goes up. Its row in Media, with its own live picture.
 */
async function addInput(win: Page): Promise<Locator> {
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await win.getByTestId('add-video-input').click();
  const dialog = win.getByTestId('video-input-dialog');
  await expect(dialog).toBeVisible();
  const choice = dialog.getByTestId('video-input-device').and(dialog.locator(`[data-name="${DEVICE}"]`));
  await expect(choice).toBeVisible({ timeout: 15_000 });
  // With the fake camera Drashti may use the cameras: no question first.
  await expect(dialog.getByTestId('video-input-why')).toHaveCount(0);
  // Each input by name with a small live picture.
  await expect.poll(() => videoWidth(choice), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(dialog.getByTestId('video-input-save')).toBeDisabled();
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  // Input 1 is offered; the operator names it.
  await expect(dialog.getByTestId('video-input-name')).toHaveValue('Input 1');
  await dialog.getByTestId('video-input-name').fill(INPUT);
  await expect(dialog.getByTestId('video-input-fit')).toHaveValue('fit');
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'Add a Video Input, an input chosen and named');
  expect(await background(win)).toBeNull();
  await dialog.getByTestId('video-input-save').click();
  await expect(dialog).toHaveCount(0);
  const row = sheet.getByTestId('video-input-row').and(sheet.locator(`[data-name="${INPUT}"]`));
  await expect(row).toBeVisible();
  await expect(row.getByTestId('video-input-note')).toHaveText('Video input · fitted inside');
  await expect.poll(() => videoWidth(row), { timeout: 15_000 }).toBeGreaterThan(0);
  // Kept, and still nothing up.
  expect(await background(win)).toBeNull();
  return row;
}

/**
 * What a page draws of the input up now (`within` the part of the page that draws it): how its capture stands,
 * how many frames its live picture has had (counted from the first look), and whether its picture has light in
 * it, from the live picture or, once stopped, the one kept: the fake camera's pattern, never black.
 */
async function drawn(
  page: Page,
  within = '',
): Promise<{ state: string | null; frames: number; lit: boolean }> {
  return page.evaluate((root) => {
    const box = document.querySelector(`${root} [data-kind="input"]`.trim());
    const state = box?.getAttribute('data-input-state') ?? null;
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
    const source = state === 'live' ? video : kept;
    let lit = false;
    if (source && (source instanceof HTMLCanvasElement ? source.width > 0 : source.videoWidth > 0)) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 18;
      const g = c.getContext('2d');
      g?.drawImage(source, 0, 0, 32, 18);
      const data = g ? g.getImageData(0, 0, 32, 18).data : new Uint8ClampedArray();
      for (let i = 0; i < data.length; i += 4)
        if (Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) > 60) lit = true;
    }
    return { state, frames: seen.frames ?? 0, lit };
  }, within);
}

/**
 * Its picture plays on this page: live, on screen, with light in it, and (on a hall's screen) new frames coming.
 * The operator window and the stream's offscreen page are not asked for frames: a window under others may draw
 * none, whatever it plays.
 */
async function playsOn(
  page: Page,
  { within = '', frames = false }: { within?: string; frames?: boolean } = {},
): Promise<void> {
  const box = page.locator(`${within} [data-kind="input"]`.trim()).first();
  await expect(box).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect(box).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect.poll(async () => (await drawn(page, within)).lit, { timeout: 10_000 }).toBe(true);
  if (!frames) return;
  const framesNow = (await drawn(page, within)).frames;
  await expect
    .poll(async () => (await drawn(page, within)).frames, { timeout: 10_000 })
    .toBeGreaterThan(framesNow + 3);
}

const LIVE = { within: '[data-testid="live-preview"]' };
const HALL = { frames: true };

/**
 * The input unplugged, as a page hears it: the computer no longer lists it, and its picture ends (a page's own
 * stop says nothing, so the ended event the computer would send is sent too). plugIn lists it again, and says
 * the devices changed.
 */
async function unplug(page: Page): Promise<void> {
  await page.evaluate(() => {
    const devices = navigator.mediaDevices;
    const w = window as unknown as { drashtiTestPlugIn?: () => void };
    if (!w.drashtiTestPlugIn) {
      const list = devices.enumerateDevices.bind(devices);
      devices.enumerateDevices = async () => (await list()).filter((d) => d.kind !== 'videoinput');
      w.drashtiTestPlugIn = () => {
        devices.enumerateDevices = list;
        delete w.drashtiTestPlugIn;
        devices.dispatchEvent(new Event('devicechange'));
      };
    }
    for (const video of document.querySelectorAll<HTMLVideoElement>('[data-kind="input"] video')) {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) continue;
      for (const track of stream.getVideoTracks()) {
        track.stop();
        track.dispatchEvent(new Event('ended'));
      }
    }
  });
}

async function plugIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { drashtiTestPlugIn?: () => void }).drashtiTestPlugIn?.();
  });
}

test('Add a Video Input… names the fake camera; one click puts it on the hall’s screen, LIVE and the stream’s Slides layout with the slide over it; black-out and the logo cover it; Clear all, Put it back and F3', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
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

  const row = await addInput(win);
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'Media’s Video inputs');
  // One click: up as the live background, as Media named it.
  await row.getByTestId('video-input-show').click();
  await expect
    .poll(() => background(win))
    .toMatchObject({ kind: 'input', name: INPUT, device: DEVICE, fit: 'fit' });
  await expect(row).toHaveAttribute('data-live', 'true');

  // On the hall's screen: the fake camera's moving pattern, fitted inside.
  await playsOn(hall, HALL);
  await expect(hall.locator('[data-kind="input"] video')).toHaveCSS('object-fit', 'contain');
  // The stage screen says what is up, as for a window; it never draws it.
  await expect(stage.getByTestId('stage-current')).toContainText('Video input on the screens');
  await expect(stage.locator('[data-kind="input"]')).toHaveCount(0);
  // LIVE in the operator window draws it too.
  await playsOn(win, LIVE);

  // The slide stays over it, and a message over that; the input plays on under them.
  const kirtan = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).find((p) =>
        p.name.startsWith('Sample kirtan'),
      )?.id ?? '',
  );
  await dispatch(win, { type: 'goLive', presentationId: kirtan, slideIndex: 0 });
  await expect(hall.locator('[data-layer="slide"]')).toBeVisible();
  await dispatch(win, {
    type: 'showMessage',
    message: { id: 'placeholder-message', text: 'Placeholder message' },
  });
  await expect(hall.locator('[data-layer="messages"]')).toContainText('Placeholder message');
  expect(
    await hall.evaluate(() => {
      const under = document.querySelector('[data-kind="input"]');
      const over = [
        document.querySelector('[data-layer="slide"]'),
        document.querySelector('[data-layer="messages"]'),
      ];
      return (
        under !== null &&
        over.every(
          (o) => o !== null && (under.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
      );
    }),
  ).toBe(true);
  expect(await background(win)).toMatchObject({ kind: 'input' });
  await expect(hall.locator('[data-kind="input"]')).toHaveAttribute('data-input-state', 'live');
  await dispatch(win, { type: 'hideMessage', messageId: 'placeholder-message' });

  // The stream: its Camera layout keeps its own camera (the words as a lower third); its Slides layout shows
  // the input as the hall does.
  await win.getByTestId('open-stream').click();
  const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
    timeout: 60_000,
  });
  await expect(program.getByTestId('program-picture')).toHaveAttribute('data-kind', 'camera');
  await expect(program.locator('[data-kind="input"]')).toHaveCount(0);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-layout', 'slides');
  await playsOn(program);
  await expect(program.locator('[data-layer="slide"]')).toBeVisible();
  await win.getByRole('button', { name: 'Close stream' }).click();

  // Black-out and the logo cover it, and take nothing off.
  await dispatch(win, { type: 'setBlackout', on: true });
  await expect(hall.getByTestId('blackout')).toBeVisible();
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(1);
  await dispatch(win, { type: 'setBlackout', on: false });
  await dispatch(win, {
    type: 'showLogo',
    prop: { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] },
  });
  await expect(hall.getByTestId('logo')).toBeVisible();
  await dispatch(win, { type: 'hideLogo' });
  await expect(hall.getByTestId('logo')).toHaveCount(0);
  expect(await background(win)).toMatchObject({ kind: 'input' });

  // Clear all takes it off; Put it back brings it back.
  await win.getByRole('button', { name: 'Clear all' }).click();
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(0);
  expect(await background(win)).toBeNull();
  await win.getByTestId('put-back').click();
  await playsOn(hall, HALL);
  expect(await background(win)).toMatchObject({ kind: 'input', name: INPUT });
  // F3 (Clear background) takes it off too.
  await closeLibrary(win);
  await win.keyboard.press('F3');
  await expect(hall.locator('[data-kind="input"]')).toHaveCount(0);
  await expect.poll(() => background(win)).toBeNull();
  await app.close();
});

test('a video input that stops keeps its last picture, says so with Clear the input, and comes back by itself', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  const row = await addInput(win);
  await row.getByTestId('video-input-show').click();
  await playsOn(hall, HALL);
  await playsOn(win, LIVE);
  const notice = win.getByTestId('video-input-stopped');
  await expect(notice).toHaveCount(0);

  // Unplugged (on the hall's screen and in the operator window): the screen keeps its last picture, never black,
  // and the notice says so.
  await unplug(hall);
  await unplug(win);
  const box = hall.locator('[data-kind="input"]');
  await expect(box).toHaveAttribute('data-input-state', 'stopped', { timeout: 10_000 });
  await letTimePass(hall, 2500, 'the kept picture stays after a copy would have been taken twice more');
  expect((await drawn(hall)).lit).toBe(true);
  await expect(notice).toContainText(`The video input “${INPUT}” has stopped`, { timeout: 10_000 });
  await expect(notice).toContainText('it comes back by itself when the input returns');
  // Media's row says why it has no picture (once its next try finds it is not there).
  await expect(row.getByTestId('video-input-note')).toHaveText('Video input · not connected', {
    timeout: 15_000,
  });
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'a video input stopped');

  // Plugged in again: it plays by itself, and the notice goes.
  await plugIn(hall);
  await plugIn(win);
  await playsOn(hall, HALL);
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
  await expect(row.getByTestId('video-input-note')).toHaveText('Video input · fitted inside');

  // Unplugged again: Clear the input takes it off.
  await unplug(hall);
  await unplug(win);
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await notice.getByTestId('video-input-clear').click();
  await expect(box).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(await background(win)).toBeNull();
  await app.close();
});

test('a phone names a video input and clears it, never draws or chooses one; the dashboard says the nodes cannot show it; Simple Mode cannot add one', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...FAKE, ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const row = await addInput(win);
  await row.getByTestId('video-input-show').click();
  await expect.poll(() => background(win)).toMatchObject({ kind: 'input', name: INPUT });

  // The screens dashboard: on this computer's screens only.
  await closeLibrary(win);
  await win.getByTestId('screens-summary').click();
  const dashboard = win.getByTestId('screens-dashboard');
  await expect(dashboard.getByTestId('dashboard-input')).toHaveText(
    `The video input “${INPUT}” shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.`,
  );
  await win.getByRole('button', { name: 'Close the dashboard' }).click();
  await expect(dashboard).toHaveCount(0);

  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    const p = phone.page;
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const line = p.getByTestId('remote-input');
    await expect(line).toContainText(`Video input: ${INPUT}`);
    // A phone's own picture draws nothing for it (the input is on Main's computer).
    await expect(p.locator('[data-kind="input"]')).toHaveCount(0);
    await line.getByTestId('remote-input-clear').click();
    await expect(line).toHaveCount(0);
    expect(await background(win)).toBeNull();
  } finally {
    await phone.close();
  }

  // Simple Mode: no Add a Video Input…, and the main process refuses one from the window too.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('add-video-input')).toHaveCount(0);
  expect(
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.videoInputs.add({
        name: 'Another input',
        device: 'fake_device_0',
        fit: 'fit',
      }),
    ),
  ).toMatchObject({ ok: false });
  await app.close();
});

test('after an unexpected stop the video input is put back when it is there', async () => {
  test.setTimeout(150_000);
  const first = await launchApp({ ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const row = await addInput(win);
  await row.getByTestId('video-input-show').click();
  await savedLive(first.userData, (saved) => saved.background?.kind === 'input');
  await killApp(first.app);
  const second = await relaunchApp(first.userData, { ...FAKE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await expect
    .poll(() => background(win2), { timeout: 15_000 })
    .toMatchObject({ kind: 'input', name: INPUT });
  await expect.poll(() => outputPages(second.app).length).toBe(1);
  const [hall] = outputPages(second.app);
  if (!hall) throw new Error('a screen expected');
  await playsOn(hall, HALL);
  await second.app.close();
});
