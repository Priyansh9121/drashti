import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import type { PipPlace } from '../../src/shared/engine/state';
import { LOOK_LAYERS } from '../../src/shared/looks';
import { pipSwapMs } from '../../src/shared/pip';
import { pipRect } from '../../src/renderer/src/render/pip';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { drawPicture, engineState, goLive, holdClock, makeSlides, plain } from './placeholder-slides';
import { makeTestVideo } from './test-media';

/*
 * Picture in picture (Session 50): something small in a corner of the hall's screens while the main picture
 * carries on. The slides in the box (the main picture shows the background without the slide), a video from
 * Media, a video input (Chromium's fake camera: DRASHTI_TEST_FAKE_DEVICES, never a real one) and a window (Session
 * 48's stand-in, a placeholder window the test opens itself: DRASHTI_TEST_WINDOW_STANDIN), each as an output
 * draws it; Swap, Take off, Clear all and Put it back; a Look leaving the box out of the hall's group; black-out
 * and the logo over it; dragging it in LIVE; the stream's Slides layout; and the phone remote. Session 51: Swap
 * moves the main picture's own change with the box at held moments; the stream's Camera layout shows the box with
 * the hall's picture at full frame; a key and fill group leaves the box out unless its Look turns it on. Generated
 * media and placeholder words only. Quiet: outputs as windows, nothing wider than 1024 assumed.
 */

const WINDOWED = { DRASHTI_WINDOWED_OUTPUTS: '1' };
const MEETING = 'Placeholder meeting';

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** The box as the engine has it now. */
const pipNow = async (win: Page) => (await engineState(win)).layers.pip;

const PLACE: PipPlace = {
  corner: 'bottom-right',
  x: 0,
  y: 0,
  size: 'medium',
  border: true,
  rounded: true,
  motion: 'fade',
};

/**
 * What a screen draws of the box: whether it is up (and swapped) on the scene, the box's own marks and how it
 * is drawn now, the pictures drawn on the main picture and in the box (not those ready unseen for a swap), and
 * the main picture's own picture moving with the box in a swap (Session 51), drawn or not.
 */
function drawn(page: Page) {
  return page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('[data-testid="scene"]');
    const box = document.querySelector<HTMLElement>('[data-testid="pip-box"]');
    const moving = document.querySelector<HTMLElement>('[data-pip-main][data-pip-moving]');
    const shown = (els: Iterable<HTMLElement>, key: string) =>
      [...els].filter((e) => e.dataset['pipReady'] === undefined).map((e) => e.dataset[key] ?? '');
    return {
      canvas: scene?.dataset['canvas'] ?? '',
      pip: scene?.dataset['pip'] ?? '',
      main: shown(document.querySelectorAll<HTMLElement>('[data-pip-main]'), 'pipMain'),
      moving: moving
        ? {
            picture: moving.dataset['pipMain'] ?? '',
            shown: moving.dataset['pipReady'] === undefined,
            at: moving.dataset['pipAt'] ?? '',
            opacity: moving.style.opacity,
            transform: moving.style.transform,
            // Whole on the screen's black as it moves.
            base: moving.querySelector(':scope > [data-pip-base]') !== null,
          }
        : null,
      inBox: box ? shown(box.querySelectorAll<HTMLElement>('[data-pip-slot]'), 'pipSlot') : [],
      box: box
        ? {
            source: box.dataset['pipSource'] ?? '',
            swapped: box.dataset['pipSwapped'] ?? '',
            phase: box.dataset['pipPhase'] ?? '',
            at: box.dataset['pipAt'] ?? '',
            corner: box.dataset['pipCorner'] ?? '',
            size: box.dataset['pipSize'] ?? '',
            rect: box.dataset['pipRect'] ?? '',
            opacity: box.style.opacity,
            border: box.querySelector('[data-pip-border]') !== null,
          }
        : null,
    };
  });
}

/** Where the box should be on a screen of this canvas ("1920x1080"), as its marks write it. */
function rectOn(canvas: string, place: PipPlace): string {
  const [width = 1920, height = 1080] = canvas.split('x').map(Number);
  const r = pipRect(place, { width, height });
  return `${String(r.x)},${String(r.y)},${String(r.width)},${String(r.height)}`;
}

/** Held before a change, so every screen waits at its start; then the change. */
async function heldChange(app: ElectronApplication, change: () => Promise<unknown>): Promise<void> {
  await holdClock(app, Date.now() - 60_000);
  await change();
}

/** A placeholder picture and words, the picture up as the background and the first slide up. */
async function backdropAndWords(win: Page): Promise<{ backdrop: string; slides: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pip-'));
  const file = await drawPicture(win, join(dir, 'Placeholder backdrop.png'), plain('29,78,216'));
  const [backdrop = ''] = await importAndGetIds(win, [file]);
  const slides = await makeSlides(
    win,
    'Placeholder box words',
    [{ words: 'Placeholder words one' }, { words: 'Placeholder words two' }],
    { kind: 'cut', durationMs: 0 },
  );
  return { backdrop, slides };
}

async function upWithBackdrop(win: Page, backdrop: string, slides: string): Promise<void> {
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: backdrop, media: 'image', fit: 'fill', loop: false },
  });
  await goLive(win, slides, 0);
}

test('the slides in the box from Picture in Picture…: the background alone on the main picture, the slide small in its corner; Swap, the slide moving in and out with the box; Take off, Clear all and Put it back', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...WINDOWED, DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { backdrop, slides } = await backdropAndWords(win);
  await setUpScreen(win);
  const hall = await outputPage(app);
  await outputReady(hall);
  await upWithBackdrop(win, backdrop, slides);
  await expect.poll(async () => (await drawn(hall)).main).toEqual(['background', 'slide']);
  expect((await drawn(hall)).pip).toBe('none');

  // Picture in Picture…, beside Show a Window… in the library's Media tools: nothing goes up until Show in the box.
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await expect(win.getByTestId('show-a-window')).toBeVisible();
  await win.getByTestId('pip-open').click();
  const dialog = win.getByTestId('pip-dialog');
  await expect(dialog).toBeVisible();
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'Picture in Picture');
  await dialog.getByTestId('pip-kind-slides').click();
  await expect(dialog.getByTestId('pip-kind-slides')).toHaveAttribute('aria-checked', 'true');
  await dialog.getByTestId('pip-corner-top-left').click();
  await dialog.getByTestId('pip-size-small').click();
  await dialog.getByTestId('pip-motion-fade').click();
  expect(await pipNow(win)).toBeNull();
  // The library remembers where the box goes, for next time.
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.pip.place()))
    .toMatchObject({ corner: 'top-left', size: 'small', motion: 'fade' });

  // In: from when it went up, fading, the same on every screen (held at a moment part-way).
  await heldChange(app, () => dialog.getByTestId('pip-show').click());
  await expect(dialog).toHaveCount(0);
  const box = await pipNow(win);
  expect(box).toMatchObject({
    source: { kind: 'slides' },
    swapped: false,
    place: { corner: 'top-left', size: 'small' },
  });
  const shownAt = box?.shownAt ?? 0;
  await holdClock(app, shownAt + 120);
  await expect.poll(async () => (await drawn(hall)).box?.at).toBe('120');
  const coming = await drawn(hall);
  expect(coming.box?.phase).toBe('in');
  expect(Number(coming.box?.opacity)).toBeGreaterThan(0);
  expect(Number(coming.box?.opacity)).toBeLessThan(1);
  await holdClock(app, shownAt + 2000);
  await expect.poll(async () => (await drawn(hall)).box?.phase).toBe('still');
  // The hall: the background alone on the main picture, the slide as designed in the box, small, top left.
  const up = await drawn(hall);
  expect(up).toMatchObject({
    pip: 'up',
    main: ['background'],
    inBox: ['slide'],
    box: { source: 'slides', corner: 'top-left', size: 'small', opacity: '', border: true },
  });
  expect(up.box?.rect).toBe(rectOn(up.canvas, { ...PLACE, corner: 'top-left', size: 'small' }));
  await expect(hall.locator('[data-testid="pip-box"] [data-layer="slide"]')).toContainText(
    'Placeholder words one',
  );
  await expect(hall.locator('[data-pip-main="background"] [data-layer="background"]')).toHaveCount(1);
  // LIVE draws it too, and says what is in it under the picture.
  await expect(win.getByTestId('live-preview').getByTestId('pip-box')).toHaveCount(1);
  await expect(win.getByTestId('live-pip')).toContainText('Picture in picture · the slides');
  // The next slide goes into the box.
  await goLive(win, slides, 1);
  await expect(hall.locator('[data-testid="pip-box"] [data-layer="slide"]')).toContainText(
    'Placeholder words two',
  );
  // With no slide up, a box of the slides draws nothing (it stays up); the slide again brings it back.
  await dispatch(win, { type: 'clearLayer', layer: 'slide' });
  await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  expect((await pipNow(win))?.source.kind).toBe('slides');
  expect((await drawn(hall)).pip).toBe('none');
  await goLive(win, slides, 1);
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);

  // Swap, under LIVE: the box goes out and comes in again, its pictures changing places at its middle, out of
  // sight, those for after it ready unseen. The main picture's own change moves with it (Session 51), the same
  // move at the same moment, never a cut at the middle: here the slide comes in whole, on black, over the
  // background as the box comes in again (a Fade, Calm: 250 ms out, then 250 ms in).
  const moment = async (at: number, t: number) => {
    await holdClock(app, at + t);
    // Drawn at the moment held: the box, and the main picture's moving picture when there is one.
    await expect
      .poll(async () => {
        const d = await drawn(hall);
        return d.box?.at === String(t) && (d.moving === null || d.moving.at === String(t));
      })
      .toBe(true);
    return drawn(hall);
  };
  await heldChange(app, () => win.getByTestId('live-pip-swap').click());
  await expect.poll(async () => (await pipNow(win))?.swapped).toBe(true);
  const changedAt = (await pipNow(win))?.changed?.at ?? 0;
  expect(await moment(changedAt, 100)).toMatchObject({
    main: ['background'],
    inBox: ['slide'],
    box: { phase: 'swap', swapped: 'false' },
    moving: { picture: 'slide', shown: false },
  });
  await expect(hall.locator('[data-pip-main="slide"][data-pip-ready]')).toHaveCount(1);
  await expect(
    hall.locator('[data-testid="pip-box"] [data-pip-slot="background"][data-pip-ready]'),
  ).toHaveCount(1);
  // Just past the middle: the box's pictures have changed places unseen; the slide is only starting to come in,
  // the background whole under it.
  const middle = await moment(changedAt, 251);
  expect(middle).toMatchObject({
    main: ['background', 'slide'],
    inBox: ['background'],
    box: { phase: 'swap', swapped: 'true' },
    moving: { picture: 'slide', shown: true, base: true },
  });
  expect(Number(middle.moving?.opacity)).toBeLessThan(0.01);
  // Half way through the in: the slide half in over the background, as the box is.
  const halfIn = await moment(changedAt, 375);
  expect(halfIn).toMatchObject({ main: ['background', 'slide'], moving: { picture: 'slide', base: true } });
  expect(Number(halfIn.moving?.opacity)).toBeCloseTo(0.5, 2);
  expect(halfIn.moving?.opacity).toBe(halfIn.box?.opacity);
  await holdClock(app, changedAt + 3000);
  await expect.poll(async () => (await drawn(hall)).box?.phase).toBe('still');
  expect(await drawn(hall)).toMatchObject({
    pip: 'swapped',
    main: ['slide'],
    inBox: ['background'],
    moving: null,
  });
  await expect(win.getByTestId('live-pip')).toContainText('swapped');
  // Swapped back: the slide goes out over the background as the box goes out, then comes in again in the box.
  // A Swap pressed while one still runs changes nothing (Session 51): the first one is over by the engine's own
  // clock first, which ran on while the screens were held.
  await expect.poll(() => Date.now() - changedAt).toBeGreaterThanOrEqual(pipSwapMs([]));
  await heldChange(app, () => win.getByTestId('live-pip-swap').click());
  await expect.poll(async () => (await pipNow(win))?.swapped).toBe(false);
  const backAt = (await pipNow(win))?.changed?.at ?? 0;
  const going = await moment(backAt, 125);
  expect(going).toMatchObject({
    main: ['background', 'slide'],
    inBox: ['background'],
    box: { phase: 'swap', swapped: 'true' },
    moving: { picture: 'slide', shown: true, base: true },
  });
  expect(Number(going.moving?.opacity)).toBeCloseTo(0.5, 2);
  expect(going.moving?.opacity).toBe(going.box?.opacity);
  expect(await moment(backAt, 300)).toMatchObject({ main: ['background'], inBox: ['slide'], moving: null });
  await holdClock(app, backAt + 3000);
  await expect.poll(async () => (await drawn(hall)).box?.phase).toBe('still');
  expect(await drawn(hall)).toMatchObject({
    pip: 'up',
    main: ['background'],
    inBox: ['slide'],
    moving: null,
  });
  await holdClock(app, null);

  // Take off: the main picture is whole again at once, and the box goes out.
  await win.getByTestId('live-pip-take-off').click();
  await expect.poll(() => pipNow(win)).toBeNull();
  await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  expect(await drawn(hall)).toMatchObject({ pip: 'none', main: ['background', 'slide'] });
  await expect(win.getByTestId('live-pip')).toHaveCount(0);

  // Up again where the library keeps it; Clear all takes it off with the rest, and Put it back brings it back.
  await dispatch(win, { type: 'showPip', source: { kind: 'slides' } });
  await expect(hall.getByTestId('pip-box')).toHaveAttribute('data-pip-corner', 'top-left');
  await win.getByRole('button', { name: 'Clear all' }).click();
  await expect.poll(() => pipNow(win)).toBeNull();
  await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  await win.getByTestId('put-back').click();
  await expect.poll(async () => (await pipNow(win))?.source.kind).toBe('slides');
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  await app.close();
});

/** A placeholder window, opened in Drashti's own process without taking the focus: a moving test pattern. */
function openPlaceholder(app: ElectronApplication): Promise<number> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${MEETING}</title><style>html,body{margin:0;height:100%;background:#15803d}</style></head><body></body></html>`;
  return app.evaluate(async ({ BrowserWindow }, page) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title: 'Placeholder meeting',
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    w.showInactive();
    return w.id;
  }, html);
}

/** Chromium's fake camera's name, as the operator window's page sees it (it is the only camera there is). */
async function fakeCamera(win: Page): Promise<string> {
  const label = await win.evaluate(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.find((d) => d.kind === 'videoinput' && d.label !== '')?.label ?? '';
  });
  return label || 'fake_device_0';
}

test('a video from Media, a video input and a window in the box, live and silent, full once swapped; LIVE and the stream’s Slides layout show it', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({
    ...WINDOWED,
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_WINDOW_STANDIN: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pip-'));
  const [clip = ''] = await importAndGetIds(win, [
    await makeTestVideo(win, join(dir, 'Placeholder box clip.webm'), { seconds: 3, hue: 140 }),
  ]);
  await setUpScreen(win);
  const hall = await outputPage(app);
  await outputReady(hall);

  // A video from Media: it plays from when the box went up, round and round, muted, fitted inside the box.
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: clip }, place: PLACE });
  const video = hall.locator('[data-testid="pip-box"] [data-pip-picture="media"] video');
  await expect(video).toHaveCount(1);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThan(0.3);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, loop: v.loop }))).toEqual({
    muted: true,
    loop: true,
  });
  expect((await drawn(hall)).box).toMatchObject({ source: 'media', corner: 'bottom-right', size: 'medium' });
  // Swapped: the video fills the background's place, under the slide, and the background goes in the box.
  await dispatch(win, { type: 'swapPip' });
  await expect.poll(async () => (await drawn(hall)).main, { timeout: 5000 }).toEqual(['source', 'slide']);
  await expect(hall.locator('[data-pip-main="source"] [data-pip-picture="media"] video')).toHaveCount(1);
  expect((await drawn(hall)).inBox).toEqual(['background']);
  await dispatch(win, { type: 'swapPip' });
  await expect.poll(async () => (await drawn(hall)).main, { timeout: 5000 }).toEqual(['background', 'slide']);

  // A video input (the fake camera), named as Media's Video inputs name one: live, video only.
  const camera = await fakeCamera(win);
  const inputId = await win.evaluate(async (device) => {
    const made = await (globalThis as PageGlobals).drashti.videoInputs.add({
      name: 'Placeholder input',
      device,
      fit: 'fit',
    });
    if (!made.ok) throw new Error(made.message);
    return made.view.inputs.find((i) => i.name === 'Placeholder input')?.id ?? '';
  }, camera);
  await dispatch(win, { type: 'showPip', source: { kind: 'input', inputId } });
  const input = hall.locator('[data-testid="pip-box"] [data-pip-picture="input"]');
  await expect(input).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect
    .poll(() => input.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
  expect(
    await input.locator('video').evaluate((v: HTMLVideoElement) => ({
      muted: v.muted,
      sound: (v.srcObject as MediaStream | null)?.getAudioTracks().length ?? -1,
    })),
  ).toEqual({ muted: true, sound: 0 });
  await expect(win.getByTestId('live-pip')).toContainText('Placeholder input');

  // A window from Show a Window…'s list (the placeholder the test opened): live in the box, silent.
  const meeting = await openPlaceholder(app);
  const offered = await win.evaluate(async () => {
    const list = await (globalThis as PageGlobals).drashti.liveWindow.list();
    return list.ok ? list.windows.map((w) => ({ id: w.id, name: w.name })) : [];
  });
  const choice = offered.find((w) => w.name === MEETING);
  expect(choice, 'the placeholder window is offered').toBeDefined();
  await dispatch(win, { type: 'showPip', source: { kind: 'window', id: choice?.id ?? '' } });
  const shown = hall.locator('[data-testid="pip-box"] [data-pip-picture="window"]');
  await expect(shown).toHaveAttribute('data-window-state', 'live', { timeout: 15_000 });
  await expect(win.getByTestId('live-pip')).toContainText(MEETING);
  await expect(win.getByTestId('live-preview').locator('[data-pip-picture="window"]')).toHaveCount(1);
  // The background layer is not the window: the box's is its own.
  await expect(hall.locator('[data-layer="background"][data-kind="window"]')).toHaveCount(0);

  // The stream's Slides layout draws the hall's picture, the box with it.
  await win.getByTestId('open-stream').click();
  const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
    timeout: 60_000,
  });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-layout', 'slides');
  await expect(program.locator('[data-testid="pip-box"] [data-pip-picture="window"]')).toHaveAttribute(
    'data-window-state',
    'live',
    { timeout: 15_000 },
  );
  await win.getByRole('button', { name: 'Close stream' }).click();

  await dispatch(win, { type: 'hidePip' });
  await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), meeting);
  await app.close();
});

test('a Look that leaves the box out of the hall’s group hides it there, the slide back on the main picture; black-out and the logo cover it; LIVE drags it into a corner', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(WINDOWED);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { backdrop, slides } = await backdropAndWords(win);
  await setUpScreen(win);
  const hall = await outputPage(app);
  await outputReady(hall);
  await upWithBackdrop(win, backdrop, slides);
  await dispatch(win, { type: 'showPip', source: { kind: 'slides' }, place: PLACE });
  await expect.poll(async () => (await drawn(hall)).inBox).toEqual(['slide']);

  // The live Look leaves the box out of the hall's group: no box there, the slide back on its main picture.
  const setLayers = (layers: readonly string[]) =>
    win.evaluate(async (layers) => {
      const d = (globalThis as PageGlobals).drashti;
      const look = (await d.engine.snapshot()).state.look.id;
      const group = (await d.screens.get()).groups.find((g) => g.name === 'Main Hall');
      const set = await d.looks.setGroup(look, group?.id ?? '', { layers: layers as never });
      if (!set.ok) throw new Error(set.message);
    }, layers);
  await setLayers(LOOK_LAYERS.filter((l) => (l as string) !== 'pip'));
  await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  expect(await drawn(hall)).toMatchObject({ pip: 'none', main: ['background', 'slide'] });
  expect((await pipNow(win))?.source.kind, 'still up for the other groups').toBe('slides');
  await setLayers(LOOK_LAYERS);
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  expect((await drawn(hall)).main).toEqual(['background']);

  // Black-out and the logo cover it, and take nothing off.
  await dispatch(win, { type: 'setBlackout', on: true });
  await expect(hall.getByTestId('blackout')).toBeVisible();
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  await dispatch(win, { type: 'setBlackout', on: false });
  await dispatch(win, {
    type: 'showLogo',
    prop: { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] },
  });
  await expect(hall.getByTestId('logo')).toBeVisible();
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  await dispatch(win, { type: 'hideLogo' });
  await expect(hall.getByTestId('logo')).toHaveCount(0);

  // LIVE: dragged near the top left corner, it goes into it, and the hall's box moves there.
  const handle = win.getByTestId('live-pip-handle');
  const from = await handle.boundingBox();
  if (!from) throw new Error('the box is not in LIVE');
  const canvas = { width: 1920, height: 1080 };
  const was = pipRect(PLACE, canvas);
  const corner = pipRect({ ...PLACE, corner: 'top-left' }, canvas);
  const scale = from.width / was.width;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: start.x + (corner.x - was.x) * scale + 2, y: start.y + (corner.y - was.y) * scale + 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x - 10, start.y - 10, { steps: 3 });
  await win.mouse.move(end.x, end.y, { steps: 10 });
  await expect(win.getByTestId('live-pip-landing')).toHaveCount(1);
  await win.mouse.up();
  await expect.poll(async () => (await pipNow(win))?.place.corner).toBe('top-left');
  await expect(hall.getByTestId('pip-box')).toHaveAttribute('data-pip-corner', 'top-left');
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.pip.place()))
    .toMatchObject({ corner: 'top-left' });
  // A click is not a drag: it stays where it is.
  const again = await handle.boundingBox();
  if (again) await win.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  expect((await pipNow(win))?.place.corner).toBe('top-left');
  await app.close();
});

test('the phone remote names the box and takes it off; it has nothing to set one up', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...WINDOWED });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const hall = await outputPage(app);
  await outputReady(hall);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await expect(phone.page.getByTestId('remote-pip')).toHaveCount(0);
    await dispatch(win, { type: 'showPip', source: { kind: 'slides' }, place: PLACE });
    const named = phone.page.getByTestId('remote-pip');
    await expect(named).toContainText('Picture in picture: the slides');
    await dispatch(win, { type: 'swapPip' });
    await expect(named).toContainText('(swapped)');
    await named.getByTestId('remote-pip-take-off').click();
    await expect.poll(() => pipNow(win)).toBeNull();
    await expect(named).toHaveCount(0);
    await expect(hall.getByTestId('pip-box')).toHaveCount(0);
  } finally {
    await phone.close();
  }
  await app.close();
});

/** A placeholder picture for the box, made and put in Media. */
async function boxPicture(win: Page): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pip-'));
  const file = await drawPicture(win, join(dir, 'Placeholder box picture.png'), plain('21,128,61'));
  const [id = ''] = await importAndGetIds(win, [file]);
  return id;
}

test('the stream’s Camera layout shows the box with the hall’s picture at full frame, swapped as the hall has it; over its own camera, never', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...WINDOWED, DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { backdrop, slides } = await backdropAndWords(win);
  const boxed = await boxPicture(win);
  await setUpScreen(win);
  const hall = await outputPage(app);
  await outputReady(hall);
  // A picture up behind and no slide: the Camera layout shows the hall's picture instead of its camera.
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: backdrop, media: 'image', fit: 'fill', loop: false },
  });
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: boxed }, place: PLACE });
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  await win.getByTestId('open-stream').click();
  const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  const root = program.getByTestId('program-root');
  await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 60_000 });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('camera'));
  await expect(root).toHaveAttribute('data-layout', 'camera');
  const full = program.getByTestId('program-full');
  await expect(full).toHaveCount(1);
  // The box with it, where the hall has it, its own picture in it.
  await expect(full.getByTestId('pip-box')).toHaveCount(1);
  await expect.poll(async () => (await drawn(program)).box?.phase).toBe('still');
  const onStream = await drawn(program);
  expect(onStream).toMatchObject({
    pip: 'up',
    main: ['background', 'slide'],
    inBox: ['source'],
    box: { source: 'media', corner: 'bottom-right', size: 'medium' },
  });
  expect(onStream.box?.rect).toBe(rectOn(onStream.canvas, PLACE));
  await expect(full.locator('[data-pip-main="background"] [data-layer="background"]')).toHaveCount(1);
  // A prop up: drawn once, in the hall's picture, the box over it as on the hall's screens.
  await dispatch(win, {
    type: 'showProp',
    prop: { id: 'placeholder-prop', name: 'Placeholder prop', elements: [] },
  });
  await expect(full.locator('[data-layer="props"] ~ [data-testid="pip-box"]')).toHaveCount(1);
  await expect(program.locator('[data-layer="props"]')).toHaveCount(1);
  await dispatch(win, { type: 'hideProp', propId: 'placeholder-prop' });
  await expect(program.locator('[data-layer="props"]')).toHaveCount(0);
  // Swapped, as the hall has it: the box's picture full, the background small in the box; and back.
  await dispatch(win, { type: 'swapPip' });
  await expect.poll(async () => (await drawn(program)).main, { timeout: 5000 }).toEqual(['source', 'slide']);
  await expect.poll(async () => (await drawn(program)).inBox, { timeout: 5000 }).toEqual(['background']);
  await dispatch(win, { type: 'swapPip' });
  await expect
    .poll(async () => (await drawn(program)).main, { timeout: 5000 })
    .toEqual(['background', 'slide']);
  // A slide with words: the stream shows its own camera with the words as a lower third, and no box.
  await goLive(win, slides, 0);
  await expect(full).toHaveCount(0);
  await expect(program.getByTestId('lower-third')).toBeVisible();
  await expect(program.getByTestId('pip-box')).toHaveCount(0);
  await expect(hall.getByTestId('pip-box')).toHaveCount(1);
  // A video input behind (Chromium's fake camera), the slides in the box and a picture slide up: at full frame
  // the hall's picture, the input its main picture and the slide small in the box; swapped, the box shows the
  // input. With a box up the input is the hall's picture, never black there.
  const inputId = await win.evaluate(
    async (device) => {
      const made = await (globalThis as PageGlobals).drashti.videoInputs.add({
        name: 'Placeholder input',
        device,
        fit: 'fit',
      });
      if (!made.ok) throw new Error(made.message);
      return made.view.inputs.find((i) => i.name === 'Placeholder input')?.id ?? '';
    },
    await fakeCamera(win),
  );
  await dispatch(win, { type: 'showInput', inputId });
  await dispatch(win, { type: 'showPip', source: { kind: 'slides' }, place: PLACE });
  const pictureSlide = await makeSlides(win, 'Placeholder picture slide', [{ picture: boxed }], {
    kind: 'cut',
    durationMs: 0,
  });
  await goLive(win, pictureSlide, 0);
  await expect(full).toHaveCount(1);
  await expect(
    full.locator('[data-pip-main="background"]:not([data-pip-ready]) [data-kind="input"]'),
  ).toHaveCount(1);
  await expect(full.locator('[data-testid="pip-box"] [data-layer="slide"]')).toHaveCount(1);
  await dispatch(win, { type: 'swapPip' });
  await expect(
    full.locator(
      '[data-testid="pip-box"] [data-pip-slot="background"]:not([data-pip-ready]) [data-kind="input"]',
    ),
  ).toHaveCount(1, { timeout: 5000 });
  await expect(
    full.locator('[data-pip-main="slide"]:not([data-pip-ready]) [data-layer="slide"]'),
  ).toHaveCount(1);
  // The Slides layout: the hall's picture, the box with it.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await expect(root).toHaveAttribute('data-layout', 'slides');
  await expect(program.getByTestId('pip-box')).toHaveCount(1);
  await win.getByRole('button', { name: 'Close stream' }).click();
  await app.close();
});

test('a key and fill group leaves the box out unless its Look turns it on, in a Look made since too', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(WINDOWED);
  const win = await operatorPage(app);
  await operatorReady(win);
  const boxed = await boxPicture(win);
  // A key and fill group on this computer's display: its one screen is the fill.
  const switcher = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Placeholder switcher');
    if (!made.ok) throw new Error(made.message);
    const id = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher')?.id ?? '';
    const role = await d.screens.setGroupRole(id, 'keyfill');
    if (!role.ok) throw new Error(role.message);
    // Keep these screens? (Session 50), wherever it asks: kept, as a test needs the output.
    if ((await d.screens.pending()) !== null) await d.screens.keep();
    const display = made.snapshot.displays[0]?.id ?? -1;
    const used = await d.screens.assignDisplay(id, display, { coverOperator: true });
    if (!used.ok) throw new Error(used.message);
    if ((await d.screens.pending()) !== null) await d.screens.keep();
    return id;
  });
  const fill = await outputPage(app);
  await expect(fill.getByTestId('output-root')).toHaveAttribute('data-feed', 'fill');
  await outputReady(fill);
  const layers = async () => (await engineState(win)).look.groups[switcher]?.layers ?? [];
  // A box up: the key and fill group leaves it out, its Look saying nothing of it.
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: boxed }, place: PLACE });
  await expect.poll(async () => (await pipNow(win))?.source.kind).toBe('media');
  expect(await layers()).not.toContain('pip');
  await expect(fill.getByTestId('scene')).toHaveAttribute('data-pip', 'none');
  await expect(fill.getByTestId('pip-box')).toHaveCount(0);
  // A Look made since, from nothing, put live: left out there too.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.looks.create('Placeholder blank', null);
    if (!made.ok) throw new Error(made.message);
    const blank = made.view.looks.find((l) => l.name === 'Placeholder blank')?.id ?? '';
    const live = await d.engine.dispatch({ type: 'setLook', lookId: blank });
    if (!live.ok) throw new Error(live.message);
  });
  await expect.poll(async () => (await engineState(win)).look.name).toBe('Placeholder blank');
  expect(await layers()).not.toContain('pip');
  await expect(fill.getByTestId('scene')).toHaveAttribute('data-pip', 'none');
  await expect(fill.getByTestId('pip-box')).toHaveCount(0);
  // Turned on in the live Look (its tick in Screens): the fill draws it.
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const view = await d.looks.list();
    const shown = view.looks.find((l) => l.id === view.liveId)?.groups[id]?.layers ?? [];
    const set = await d.looks.setGroup(view.liveId, id, { layers: [...shown, 'pip'] });
    if (!set.ok) throw new Error(set.message);
  }, switcher);
  await expect(fill.getByTestId('pip-box')).toHaveCount(1);
  expect(await layers()).toContain('pip');
  await app.close();
});
