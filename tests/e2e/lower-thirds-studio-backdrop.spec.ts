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
 * a second by the main process from a hall screen on this computer, following what goes up; with none here, "No live
 * picture to show"), Dark and Light. The choice is remembered; closed, or on another backdrop, nothing is taken.
 * Generated media only (a blue wallpaper, an orange test video), placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

const isStudio = (p: Page) => p.url().includes('lower-thirds.html');

interface LiveWork {
  watching: boolean;
  taken: number;
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
    await videoUp(win, videoId);
    await expect
      .poll(async () => ORANGE(await liveColour(studio)), {
        message: 'Live follows: the video',
        timeout: 20_000,
      })
      .toBe(true);
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

test('with no hall screen on this computer (one display, or only nodes’ screens), Live says “No live picture to show”, even with a video up; nothing taken once closed', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-studio-backdrop-live-'));
  const { app } = await launchApp({});
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(outputPages(app), 'no hall screen on this computer').toHaveLength(0);
    const { wallId, videoId } = await wallpaperAndVideo(win, dir);
    await chooseWallpaper(win, wallId);
    await videoUp(win, videoId);
    const studio = await openStudio(app, win);
    await choose(studio, 'Live');
    const preview = studio.getByTestId('lower-third-preview');
    await expect(preview).toHaveAttribute('data-backdrop', 'live');
    await expect(preview.getByTestId('studio-backdrop-words')).toHaveText('No live picture to show', {
      timeout: 15_000,
    });
    await expect(preview.getByTestId('studio-live-picture')).toHaveCount(0);
    expect((await liveWork(app))?.watching, 'it keeps looking (a hall screen may be set up meanwhile)').toBe(
      true,
    );
    await expectNoSeriousA11yIssues(studio, 'the studio on Live, no hall screen here');
    await closeStudio(app, studio);
    await nothingTaken(app, 'the studio closed');
  } finally {
    await app.close();
  }
});
