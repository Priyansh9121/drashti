import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import {
  launchApp,
  openSection,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { logLines } from './log-lines';

/*
 * The Stage preview's live pictures (alpha.23; a22-review-stage S5, lead 2's QA23-STAGE8-1). Until alpha.23 a layout's
 * The video input, live box and a video input or another app's window behind the audience picture were black there,
 * unsaid. Option A drew the video input live with a camera of the preview's own; on CI the hall's frames paused ~2 s
 * each time it joined the camera, so by lead 2's rule ("If you can't prove it, name the camera too (C)") the preview
 * now names them, as a tablet does: "Video input: <name>", "A window: <name>". It opens no camera at all (no video in
 * it), so opening and closing it, before the hall's screen has the input or after, leaves the hall's camera track as it
 * was (the same track, live, its size, frame rate and device unchanged, never muted or ended, its frames coming). It
 * never says how the input stands, and Main refuses it were it to, and refuses its ask for a window.
 *
 * Chromium's fake camera (DRASHTI_TEST_FAKE_DEVICES, "fake_device_0") stands in for the video mixer, and a window the
 * test opens itself ("Placeholder meeting", DRASHTI_TEST_WINDOW_STANDIN) for another app's: never a real camera's
 * picture or a real window. Stage is on (launchApp's default); no screen has the Stage job, as with one projector.
 */

const DEVICE = 'fake_device_0';
const MEETING = 'Placeholder meeting';
const ENV = {
  DRASHTI_TEST_FAKE_DEVICES: '1',
  DRASHTI_TEST_WINDOW_STANDIN: '1',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
};

/** The Stage preview window (alpha.22): a stage screen's page in a window of its own, never a screen. */
const isPreview = (p: Page) => p.url().includes('output.html') && p.url().includes('stagePreview=');

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

const addFakeInput = (win: Page, name: string) =>
  win.evaluate(
    async ({ name, device }) => {
      const made = await (globalThis as PageGlobals).drashti.videoInputs.add({ name, device, fit: 'fit' });
      if (!made.ok) throw new Error(made.message);
      return made.view.inputs.find((i) => i.name === name)?.id ?? '';
    },
    { name, device: DEVICE },
  );

/** Save a stage layout of these boxes and choose it for every stage screen; its id. */
const chooseLayout = (win: Page, name: string, boxes: StageBox[]) =>
  win.evaluate(
    async ({ name, boxes }) => {
      const d = (globalThis as PageGlobals).drashti;
      const saved = await d.stageLayouts.save(null, { name, background: '#000000', boxes });
      if (!saved.ok) throw new Error(saved.message);
      await d.stageLayouts.choose(saved.id);
      return saved.id;
    },
    { name, boxes },
  );

const background = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );

/** How many frames a video draws in a few seconds (up to 20). */
function framesOf(video: Locator): Promise<number> {
  return video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const step = () => {
          count++;
          if (count < 20) v.requestVideoFrameCallback(step);
          else resolve(count);
        };
        v.requestVideoFrameCallback(step);
        setTimeout(() => {
          resolve(count);
        }, 8000);
      }),
  );
}

/**
 * The hall's camera track as its page holds it: whether it is the same track object as first seen there, how it
 * stands, and its settings (size, frame rate, device). Only these facts leave the page.
 */
function hallTrack(hall: Page) {
  return hall.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-kind="input"] video');
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track) return null;
    const seen = window as unknown as { firstTrack?: MediaStreamTrack };
    seen.firstTrack ??= track;
    const s = track.getSettings();
    return {
      same: seen.firstTrack === track,
      readyState: track.readyState,
      muted: track.muted,
      width: s.width ?? null,
      height: s.height ?? null,
      frameRate: s.frameRate ?? null,
      deviceId: s.deviceId ?? null,
      tracks: stream.getVideoTracks().length,
    };
  });
}

/** The placeholder meeting, opened in Drashti's own process without taking the focus (show-a-window.spec.ts). */
function openPlaceholder(app: ElectronApplication): Promise<number> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${MEETING}</title><style>html,body{margin:0;height:100%;background:#1d4ed8}</style></head><body></body></html>`;
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

/** Lines the main process writes when the Stage preview said how an input stands, or asked for a window. */
const previewAsked = (userData: string) =>
  logLines(userData).filter(
    (line) =>
      line.includes('the Stage preview said how an input stands') ||
      line.includes('the Stage preview asked to capture the window'),
  );

interface HallWatch {
  mutes: number;
  ends: number;
  frames: number;
  longestGapMs: number;
  last: number | null;
  on: boolean;
}

/**
 * Watch the hall's camera track from now (a22-review-stage8 S2): its mute and ended events, and the longest gap
 * between its frames, until hallWatched reads them. Object references stay in the page; only counts and times leave.
 */
function watchHall(hall: Page): Promise<void> {
  return hall.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-kind="input"] video');
    const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
    const track = stream?.getVideoTracks()[0];
    if (!video || !track) throw new Error('the hall plays no video input');
    const watch: HallWatch = { mutes: 0, ends: 0, frames: 0, longestGapMs: 0, last: null, on: true };
    (window as unknown as { hallWatch?: HallWatch }).hallWatch = watch;
    track.addEventListener('mute', () => {
      watch.mutes++;
    });
    track.addEventListener('ended', () => {
      watch.ends++;
    });
    const step = (now: number) => {
      if (!watch.on) return;
      if (watch.last !== null) watch.longestGapMs = Math.max(watch.longestGapMs, now - watch.last);
      watch.last = now;
      watch.frames++;
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  });
}

/** What the watch saw, and it stops; the time since the last frame counts as a gap too. */
function hallWatched(hall: Page) {
  return hall.evaluate(() => {
    const watch = (window as unknown as { hallWatch?: HallWatch }).hallWatch;
    if (!watch) throw new Error('the hall was not watched');
    watch.on = false;
    const since = watch.last === null ? 0 : performance.now() - watch.last;
    return {
      mutes: watch.mutes,
      ends: watch.ends,
      frames: watch.frames,
      longestGapMs: Math.round(Math.max(watch.longestGapMs, since)),
    };
  });
}

/**
 * The hall's picture went on through it all: never muted or ended, its frames coming. The longest gap between its
 * frames is said in the run's output, not judged: on CI's Windows without a graphics chip the hall's frames paused
 * ~2 s once in six openings of a preview with no camera in it, for no cause found (a22-stage8's diagnostic, run
 * 45422901918), so a limit would judge the computer, not the preview.
 */
async function hallWentOn(hall: Page, what: string): Promise<void> {
  const seen = await hallWatched(hall);
  console.log(`The hall's frames ${what}: ${JSON.stringify(seen)}`);
  expect(seen, `the hall's camera track ${what}`).toMatchObject({ mutes: 0, ends: 0 });
  expect(seen.frames).toBeGreaterThan(10);
}

/** The preview draws no video at all, and names the input in its video input box. */
async function namesTheInput(preview: Page, name: string): Promise<void> {
  await expect(preview.getByTestId('stage-video-input-line')).toHaveText(`Video input: ${name}`);
  await expect(preview.locator('[data-stage-input]')).toHaveCount(0);
  await expect(preview.locator('video')).toHaveCount(0);
}

test('the Stage preview names the video input and another app’s window, as a tablet does, and opens no camera: opened before the hall’s screen has the input or after, the hall’s camera track stays as it was; it never says how the input stands, and Main refuses it were it to', async () => {
  test.setTimeout(300_000);
  const { app, userData } = await launchApp(ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const hall = await outputFor(app, hallId);
  await outputReady(hall);
  const name = 'Placeholder programme';
  const input = await addFakeInput(win, name);
  // The video input large, with the hall's picture beside it.
  await chooseLayout(win, 'Placeholder preview', [
    { ...newStageBox('videoInput', 'input'), frame: { x: 0, y: 0, width: 1280, height: 720 } },
    { ...newStageBox('audience', 'hall'), frame: { x: 1280, y: 0, width: 640, height: 360 } },
  ]);
  await openSection(win, 'stage');
  const panel = win.getByTestId('stage-message-control');
  await expect(panel.getByTestId('stage-input-choice')).toHaveValue(input);
  const hallInput = hall.locator('[data-kind="input"]');
  const stopped = () =>
    win.evaluate(async () => (await (globalThis as PageGlobals).drashti.videoInputs.status()).stopped);

  // The preview FIRST (a22-review-stage8 S3: the layout set up before the service): it names the input, no camera.
  await panel.getByTestId('stage-preview-open').click();
  const first = await windowShowing(app, isPreview, 'Stage preview');
  await outputReady(first);
  await expect(first.getByTestId('output-root')).toHaveAttribute('data-stage-shows', 'layout');
  await namesTheInput(first, name);
  expect(await background(win)).toBeNull();

  // Then the input on the audience, as its background: the hall's screen plays it; the preview's audience picture
  // names it, still with no camera of its own.
  await win.getByTestId('input-on-audience').click();
  await expect.poll(async () => (await background(win))?.kind).toBe('input');
  await expect(hallInput).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect.poll(() => framesOf(hallInput.locator('video')), { timeout: 15_000 }).toBeGreaterThan(3);
  await expect(first.getByTestId('stage-audience-unseen')).toHaveText(`Video input: ${name}`);
  await namesTheInput(first, name);
  const before = await hallTrack(hall);
  expect(before).toMatchObject({ same: true, readyState: 'live', muted: false, tracks: 1 });
  expect(before?.width).toBeGreaterThan(0);
  expect(before?.deviceId).not.toBe('');

  // The preview closes during the service: the hall's track goes on as it was.
  await watchHall(hall);
  await first.close();
  await expect.poll(() => app.windows().filter(isPreview).length).toBe(0);
  expect(await framesOf(hallInput.locator('video'))).toBeGreaterThan(3);
  await hallWentOn(hall, 'as the preview closed');
  expect(await hallTrack(hall)).toEqual(before);
  await expect(hallInput).toHaveAttribute('data-input-state', 'live');

  // The hall first, then the preview: opened and closed, watched throughout.
  await watchHall(hall);
  await panel.getByTestId('stage-preview-open').click();
  const preview = await windowShowing(app, isPreview, 'Stage preview');
  await outputReady(preview);
  await expect(preview.getByTestId('stage-audience-unseen')).toHaveText(`Video input: ${name}`);
  await namesTheInput(preview, name);
  expect(await hallTrack(hall)).toEqual(before);
  // The preview said nothing of how the input stands, and the operator's notice has nothing to say.
  expect(previewAsked(userData)).toEqual([]);
  expect(await stopped()).toBeNull();

  // Were the preview's page to say the input is missing, or ask to capture a window (a22-review-stage8 S4), Main
  // refuses both and says so in the log: the input stays up, nothing is said stopped, no window is given.
  const asked = await preview.evaluate(async (inputId) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.videoInputs.report({ inputId, state: 'missing' });
    return d.liveWindow.ask('window:placeholder');
  }, input);
  expect(asked).toBe(false);
  await expect.poll(() => previewAsked(userData).length).toBe(2);
  expect(await background(win)).toMatchObject({ kind: 'input', inputId: input });
  expect(await stopped()).toBeNull();
  // Nor does it get the video inputs' list it would open one by.
  expect(
    await preview.evaluate(async () => (await (globalThis as PageGlobals).drashti.videoInputs.list()).inputs),
  ).toEqual([]);

  // Closed: the hall's track still as it was, and it went on throughout.
  await preview.close();
  await expect.poll(() => app.windows().filter(isPreview).length).toBe(0);
  expect(await framesOf(hallInput.locator('video'))).toBeGreaterThan(3);
  await hallWentOn(hall, 'as the preview opened and closed');
  expect(await hallTrack(hall)).toEqual(before);
  await expect(hallInput).toHaveAttribute('data-input-state', 'live');

  // Another app's window on the audience: the hall draws it; the preview names it and never captures it, its video
  // input box naming the input as before.
  await openPlaceholder(app);
  const listed = await win.evaluate(() => (globalThis as PageGlobals).drashti.liveWindow.list());
  const meeting = listed.ok ? listed.windows.find((w) => w.name === MEETING) : undefined;
  if (!meeting) throw new Error('the placeholder meeting was expected in the list');
  const shown = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.liveWindow.show(id),
    meeting.id,
  );
  expect(shown).toEqual({ ok: true });
  await expect.poll(async () => (await background(win))?.kind).toBe('window');
  await expect(hall.locator('[data-kind="window"]')).toHaveCount(1, { timeout: 15_000 });
  await panel.getByTestId('stage-preview-open').click();
  const again = await windowShowing(app, isPreview, 'Stage preview');
  await outputReady(again);
  await expect(again.getByTestId('stage-audience-unseen')).toHaveText(`A window: ${MEETING}`);
  await expect(again.locator('[data-kind="window"]')).toHaveCount(0);
  await namesTheInput(again, name);
  // Nothing more asked of Main than the two refused above.
  expect(previewAsked(userData)).toHaveLength(2);
  await again.close();
  await app.close();
});
