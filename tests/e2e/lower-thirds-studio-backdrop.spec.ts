import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { audienceScreen, dispatch, makeClip, SCREENS } from './hall-looks';
import type { PageGlobals } from './helpers';
import {
  holdStill,
  importAndGetIds,
  launchApp,
  openSection,
  operatorPage,
  operatorReady,
  outputPages,
  windowShowing,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * Behind the Lower Thirds studio's preview (alpha.22, the owner: "in lower thirds, the background while selecting the
 * animation should be the one thats live, meaning a video is live, or wallpaper, give wallpaper a default and aother
 * option of live as well to see how lower thirds looks"): Wallpaper (the default: the hall's chosen wallpaper, plain
 * dark with "No wallpaper chosen" before one is chosen), Live (a still of what the screens show now, taken about once
 * a second by the main process from a hall screen on this computer, following what goes up; with none here, alpha.23,
 * from Live's copy: the screens' page drawn off screen, 960 x 540, once a second, muted, never a screen, closed on every
 * other change), Dark and Light. The choice is remembered; closed, or on another backdrop, nothing is taken.
 * Generated media only (a blue wallpaper, an orange test video, Chromium's fake camera), placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

const isStudio = (p: Page) => p.url().includes('lower-thirds.html');

interface LiveWork {
  watching: boolean;
  taken: number;
  /**
   * Live's copy (alpha.23) while it is open: its size inside, frames a second, muted, its warm-up as loaded, and the
   * pictures it has really painted.
   */
  copy: {
    width: number;
    height: number;
    frameRate: number;
    muted: boolean;
    warmUp: string | null;
    paints: number;
  } | null;
}
const liveWork = (app: ElectronApplication): Promise<LiveWork | null> =>
  app.evaluate(
    () => (globalThis as { drashtiTestStudioLive?: () => LiveWork }).drashtiTestStudioLive?.() ?? null,
  );

async function openStudio(app: ElectronApplication, win: Page): Promise<Page> {
  await openSection(win, 'lower-thirds');
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  await panel.getByTestId('lower-third-studio').click();
  const studio = await windowShowing(app, isStudio, 'the Lower Thirds studio');
  await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
  return studio;
}

async function closeStudio(app: ElectronApplication, studio: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
      ?.close();
  });
  await expect.poll(() => studio.isClosed(), { message: 'the studio closes' }).toBe(true);
}

const behind = (studio: Page) => studio.getByRole('radiogroup', { name: 'Behind the preview' });

async function choose(studio: Page, name: string): Promise<void> {
  await behind(studio).getByRole('radio', { name, exact: true }).click();
  await expect(behind(studio).getByRole('radio', { name, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

/** The live still's colour, a quarter of the way down its middle (above any lower third), as the studio drew it. */
const liveColour = (studio: Page): Promise<number[] | null> =>
  studio.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="studio-live-picture"]');
    if (!img || img.naturalWidth === 0) return null;
    await img.decode().catch(() => undefined);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 4), 1, 1).data.slice(0, 3)];
  });
const BLUE = (c: number[] | null) => c !== null && (c[2] ?? 0) > 100 && (c[0] ?? 255) < 90;
const ORANGE = (c: number[] | null) => c !== null && (c[0] ?? 0) > 150 && (c[2] ?? 255) < 90;

/** A blue wallpaper chosen in Media, and an orange test video imported: their ids. */
async function wallpaperAndVideo(win: Page, dir: string): Promise<{ wallId: string; videoId: string }> {
  const wall = await makeTestImage(win, join(dir, 'Placeholder studio wall.png'), {
    color: '#1e3a8a',
    width: 320,
    height: 180,
  });
  const clip = makeClip(join(dir, 'Placeholder studio video.mp4'), 'h264', 20);
  const [wallId = '', videoId = ''] = await importAndGetIds(win, [wall, clip]);
  expect(wallId).not.toBe('');
  expect(videoId).not.toBe('');
  return { wallId, videoId };
}

const chooseWallpaper = (win: Page, mediaId: string): Promise<string> =>
  win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.wallpapers.add([id], null);
    if (!added.ok) throw new Error(added.message);
    const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
    if (!chosen.ok) throw new Error(chosen.message);
    return added.ids[0] ?? '';
  }, mediaId);

const videoUp = (win: Page, mediaId: string) =>
  dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
  });

/** Nothing more is taken once it stops: the count stays put for 2.5 s. */
async function nothingTaken(app: ElectronApplication, what: string): Promise<void> {
  await expect.poll(async () => (await liveWork(app))?.watching, { message: what }).toBe(false);
  const before = (await liveWork(app))?.taken ?? -1;
  await holdStill(async () => (await liveWork(app))?.taken === before, 2500, `${what}: no still taken`);
}

test('Behind the preview: Wallpaper by default (the hall’s wallpaper, or “No wallpaper chosen”), Live follows what the hall screen shows (the wallpaper, then a video), Dark and Light; remembered; nothing taken once closed or on another backdrop; axe passes', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-studio-backdrop-'));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await audienceScreen(app, win);
    const { wallId, videoId } = await wallpaperAndVideo(win, dir);

    // A new install: Wallpaper, with none chosen yet: plain dark, and says so.
    const studio = await openStudio(app, win);
    const radios = behind(studio).getByRole('radio');
    await expect(radios).toHaveText(['Wallpaper', 'Live', 'Dark', 'Light']);
    await expect(behind(studio).getByRole('radio', { name: 'Wallpaper' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const preview = studio.getByTestId('lower-third-preview');
    await expect(preview).toHaveAttribute('data-backdrop', 'wallpaper');
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveText('No wallpaper chosen');
    expect((await liveWork(app))?.watching, 'nothing taken on Wallpaper').toBe(false);
    await expectNoSeriousA11yIssues(studio, 'the studio on Wallpaper, none chosen');

    // A wallpaper chosen while it is open: the preview shows it at once, as the hall does.
    const wallpaper = await chooseWallpaper(win, wallId);
    const drawn = preview.getByTestId('studio-backdrop-wallpaper').locator(`[data-wallpaper="${wallpaper}"]`);
    await expect(drawn).toHaveCount(1);
    const wallImage = drawn.locator(`[data-media-id="${wallId}"] img`).first();
    await expect
      .poll(() => wallImage.evaluate((img: HTMLImageElement) => img.naturalWidth), {
        message: 'its picture drawn',
      })
      .toBeGreaterThan(0);
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveCount(0);

    // Live: the hall screen's picture (the wallpaper, nothing being up), then the video once it is up.
    await choose(studio, 'Live');
    await expect(preview).toHaveAttribute('data-backdrop', 'live');
    const still = preview.getByTestId('studio-live-picture');
    await expect(still).toHaveAttribute('data-live-source', 'screen', { timeout: 15_000 });
    await expect
      .poll(async () => BLUE(await liveColour(studio)), {
        message: 'Live shows the wallpaper',
        timeout: 15_000,
      })
      .toBe(true);
    expect((await liveWork(app))?.watching).toBe(true);
    // With a hall screen here, nothing changes: no copy.
    expect((await liveWork(app))?.copy, 'no copy with a hall screen here').toBeNull();
    await videoUp(win, videoId);
    await expect
      .poll(async () => ORANGE(await liveColour(studio)), {
        message: 'Live follows: the video',
        timeout: 20_000,
      })
      .toBe(true);
    await expect(still).toHaveAttribute('data-live-source', 'screen');
    expect((await liveWork(app))?.copy, 'still no copy with a hall screen here').toBeNull();
    await expectNoSeriousA11yIssues(studio, 'the studio on Live');

    // Dark and Light: plain, and nothing taken meanwhile.
    await choose(studio, 'Dark');
    await expect(preview).toHaveAttribute('data-backdrop', 'dark');
    await expect(still).toHaveCount(0);
    await nothingTaken(app, 'on Dark');
    await choose(studio, 'Light');
    await expect(preview).toHaveAttribute('data-backdrop', 'light');

    // Live again, then the studio closed: nothing more is taken.
    await choose(studio, 'Live');
    await expect(still).toHaveAttribute('data-live-source', 'screen', { timeout: 15_000 });
    await closeStudio(app, studio);
    await nothingTaken(app, 'the studio closed');

    // Opened again: Live, remembered, and taken again.
    const again = await openStudio(app, win);
    await expect(behind(again).getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => ORANGE(await liveColour(again)), {
        message: 'Live again: the video',
        timeout: 20_000,
      })
      .toBe(true);
    await closeStudio(app, again);
    await nothingTaken(app, 'closed again');
  } finally {
    await app.close();
  }
});

/** Live's copy, closed: none open. */
const noCopy = (app: ElectronApplication, what: string) =>
  expect.poll(async () => (await liveWork(app))?.copy ?? null, { message: what }).toBeNull();

const COPY_UNSEEN_INPUT = 'Live can’t show the video input here: there is no hall screen on this computer.';

/** This computer's screens as Screens has them. */
const screensNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.screens.get()).status);

/** Whether Live's copy's page has any camera or capture open: a video playing a live stream (srcObject). */
const copyHasCamera = (app: ElectronApplication): Promise<boolean | null> =>
  app.evaluate(async ({ BrowserWindow }) => {
    const copy = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('liveCopy='));
    if (!copy) return null;
    return (await copy.webContents.executeJavaScript(
      "[...document.querySelectorAll('video')].some((v) => v.srcObject !== null)",
    )) as boolean;
  });

test('with no hall screen showing on this computer (the hall’s projector set up here but unplugged), Live shows its copy of the screens’ picture (the wallpaper, then a video): never a screen, 960 x 540, about one picture a second, muted, no warm-up, no camera; a video input up is said plainly; closed on Dark and with the studio; axe passes', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-studio-backdrop-live-'));
  // Chromium's fake camera (a moving test pattern) stands in for a video input: never a real camera's picture.
  const { app } = await launchApp({ ...SCREENS, DRASHTI_TEST_FAKE_DEVICES: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // The owner's Mac on its own: the hall's projector was set up here, and is unplugged now (its display missing).
    await audienceScreen(app, win);
    await app.evaluate(() => {
      (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(0);
    });
    await expect
      .poll(async () => (await screensNow(win)).map((st) => st.state), { message: 'its display unplugged' })
      .toEqual(['missing-display']);
    await expect.poll(() => outputPages(app).length, { message: 'no hall screen showing here' }).toBe(0);
    const screensBefore = await screensNow(win);
    const { wallId, videoId } = await wallpaperAndVideo(win, dir);
    await chooseWallpaper(win, wallId);
    const studio = await openStudio(app, win);
    expect((await liveWork(app))?.copy ?? null, 'no copy before Live is chosen').toBeNull();

    // Live: the copy's picture of what is live (the wallpaper, nothing being up).
    await choose(studio, 'Live');
    const preview = studio.getByTestId('lower-third-preview');
    await expect(preview).toHaveAttribute('data-backdrop', 'live');
    const still = preview.getByTestId('studio-live-picture');
    await expect(still).toHaveAttribute('data-live-source', 'copy', { timeout: 20_000 });
    await expect
      .poll(async () => BLUE(await liveColour(studio)), {
        message: 'Live’s copy shows the wallpaper',
        timeout: 15_000,
      })
      .toBe(true);
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveCount(0);
    // Off screen, 960 x 540 inside, once a second, muted, drawn without a warm-up; never one of the screens: Screens
    // lists the one screen set up, as before, and no window of a screen is open.
    expect((await liveWork(app))?.copy).toMatchObject({
      width: 960,
      height: 540,
      frameRate: 1,
      muted: true,
      warmUp: 'skip',
    });
    expect(await screensNow(win), 'never counted as a screen').toEqual(screensBefore);
    expect(outputPages(app)).toHaveLength(0);

    // A video up: Live follows it, about one picture a second however much the video moves.
    await videoUp(win, videoId);
    await expect
      .poll(async () => ORANGE(await liveColour(studio)), {
        message: 'Live’s copy follows: the video',
        timeout: 20_000,
      })
      .toBe(true);
    const painted = (await liveWork(app))?.copy?.paints ?? 0;
    await holdStill(
      async () => ((await liveWork(app))?.copy?.paints ?? 0) - painted <= 7,
      5000,
      'Live’s copy paints about once a second (at most 7 in 5 s)',
    );
    await expectNoSeriousA11yIssues(studio, 'the studio on Live from its copy');

    // A video input up: the copy opens no camera and draws none, and the studio says so plainly (to screen readers
    // too); the video back, the words go.
    const inputId = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const added = await d.videoInputs.add({
        name: 'Placeholder input',
        device: 'fake_device_0',
        fit: 'fit',
      });
      if (!added.ok) throw new Error(added.message);
      return added.view.inputs[0]?.id ?? '';
    });
    expect((await dispatch(win, { type: 'showInput', inputId })).ok).toBe(true);
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveText(COPY_UNSEEN_INPUT, {
      timeout: 15_000,
    });
    await expect(studio.locator('#studio-backdrop-said')).toHaveText(COPY_UNSEEN_INPUT);
    await expect(still).toHaveAttribute('data-live-source', 'copy');
    await holdStill(async () => (await copyHasCamera(app)) === false, 2000, 'the copy opens no camera');
    expect(await screensNow(win), 'still never counted as a screen').toEqual(screensBefore);
    await videoUp(win, videoId);
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveCount(0, { timeout: 15_000 });

    // Dark: the copy closes, and nothing is taken.
    await choose(studio, 'Dark');
    await noCopy(app, 'the copy closes on Dark');
    await nothingTaken(app, 'on Dark');
    // Live again: a copy again; the studio closed: it closes, and nothing is taken.
    await choose(studio, 'Live');
    await expect(still).toHaveAttribute('data-live-source', 'copy', { timeout: 20_000 });
    await closeStudio(app, studio);
    await noCopy(app, 'the copy closes with the studio');
    await nothingTaken(app, 'the studio closed');
  } finally {
    await app.close();
  }
});

test('quitting with Live’s copy open, as it opens and once it has drawn, quits cleanly (a crash at quit fails)', async () => {
  test.setTimeout(180_000);
  for (const when of ['as it opens', 'once drawn'] as const) {
    const { app } = await launchApp({});
    const win = await operatorPage(app);
    await operatorReady(win);
    const studio = await openStudio(app, win);
    await choose(studio, 'Live');
    await expect
      .poll(async () => (await liveWork(app))?.copy ?? null, { message: `the copy opens (${when})` })
      .not.toBeNull();
    if (when === 'once drawn')
      await expect(studio.getByTestId('studio-live-picture')).toHaveAttribute('data-live-source', 'copy', {
        timeout: 20_000,
      });
    // Quit with the studio and its copy open: the harness fails a quit that ends in a crash.
    await app.close();
  }
});
