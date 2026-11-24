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
 * The Stage preview's live pictures (alpha.23; a22-review-stage S5, lead 2's QA23-STAGE8-1, option A). Until alpha.23
 * the preview got no camera and no video inputs' list, so a layout's The video input, live box and a video input
 * behind the audience picture were black there, unsaid. Now its page gets a camera as an output's: the video input
 * draws there live, from the same capture as the hall's screen, and opening and closing the preview leaves the hall's
 * camera track as it was (the same track, live, its size, frame rate and device unchanged); the preview never says
 * how the input stands (no report: the operator's notice and restart recovery hear only the screens). Another app's
 * window is never captured there: the preview names it, as a tablet does.
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
    if (!track) return null;
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
      tracks: stream?.getVideoTracks().length ?? 0,
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

/** Lines the main process writes if the Stage preview ever said how an input stands, or asked for a window. */
const previewAsked = (userData: string) =>
  logLines(userData).filter(
    (line) =>
      line.includes('the Stage preview said how an input stands') ||
      line.includes('the Stage preview asked to capture the window'),
  );

test('the Stage preview draws the video input live from the hall’s own capture, leaving the hall’s camera track as it was, and never says how it stands; another app’s window is named there, never captured', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Main Hall', 0);
  const hall = await outputFor(app, hallId);
  await outputReady(hall);
  const input = await addFakeInput(win, 'Placeholder programme');
  // The video input large, with the hall's picture beside it.
  await chooseLayout(win, 'Placeholder preview', [
    { ...newStageBox('videoInput', 'input'), frame: { x: 0, y: 0, width: 1280, height: 720 } },
    { ...newStageBox('audience', 'hall'), frame: { x: 1280, y: 0, width: 640, height: 360 } },
  ]);
  await openSection(win, 'stage');
  const panel = win.getByTestId('stage-message-control');
  await expect(panel.getByTestId('stage-input-choice')).toHaveValue(input);

  // The input on the audience, as its background: the hall's screen plays it.
  const button = win.getByTestId('input-on-audience');
  await button.click();
  await expect.poll(async () => (await background(win))?.kind).toBe('input');
  const hallInput = hall.locator('[data-kind="input"]');
  await expect(hallInput).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect.poll(() => framesOf(hallInput.locator('video')), { timeout: 15_000 }).toBeGreaterThan(3);
  const before = await hallTrack(hall);
  expect(before).toMatchObject({ same: true, readyState: 'live', muted: false, tracks: 1 });
  expect(before?.width).toBeGreaterThan(0);
  expect(before?.deviceId).not.toBe('');

  // The preview: its video input box and the audience picture's video input, live.
  await panel.getByTestId('stage-preview-open').click();
  const preview = await windowShowing(app, isPreview, 'Stage preview');
  await outputReady(preview);
  await expect(preview.getByTestId('output-root')).toHaveAttribute('data-stage-shows', 'layout');
  const inBox = preview.locator('[data-stage-box="videoInput"] [data-stage-input]');
  await expect(inBox).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  await expect.poll(() => framesOf(inBox.locator('video')), { timeout: 15_000 }).toBeGreaterThan(3);
  const inHall = preview.locator('[data-stage-box="audience"] [data-kind="input"]');
  await expect(inHall).toHaveAttribute('data-input-state', 'live', { timeout: 15_000 });
  // Nothing named over the audience picture: it is drawn.
  await expect(preview.getByTestId('stage-audience-unseen')).toHaveCount(0);

  // The hall's camera track as it was: the same track, live, the same size, frame rate and device, frames coming.
  expect(await hallTrack(hall)).toEqual(before);
  expect(await framesOf(hallInput.locator('video'))).toBeGreaterThan(3);
  // The preview said nothing of how the input stands, and the operator's notice has nothing to say.
  expect(previewAsked(userData)).toEqual([]);
  expect(
    await win.evaluate(async () => (await (globalThis as PageGlobals).drashti.videoInputs.status()).stopped),
  ).toBeNull();

  // Closed: the hall's track still as it was.
  await preview.close();
  await expect.poll(() => app.windows().filter(isPreview).length).toBe(0);
  expect(await hallTrack(hall)).toEqual(before);
  expect(await framesOf(hallInput.locator('video'))).toBeGreaterThan(3);
  await expect(hallInput).toHaveAttribute('data-input-state', 'live');

  // Another app's window on the audience: the hall draws it; the preview names it and never captures it, its own
  // video input box live as before.
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
  await expect(again.locator('[data-stage-box="videoInput"] [data-stage-input]')).toHaveAttribute(
    'data-input-state',
    'live',
    { timeout: 15_000 },
  );
  expect(previewAsked(userData)).toEqual([]);
  await again.close();
  await app.close();
});
