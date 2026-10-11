import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * YouTube in Import from a Link (Session 25c), end to end with the fake
 * yt-dlp (tests/e2e/fake-yt-dlp.cjs, chosen by a test switch a packaged
 * Drashti ignores): a made-up video (eleven As), made-up details and
 * FFmpeg-made placeholders. No test names or contacts a real video, and with
 * any test switch on Drashti never starts the real yt-dlp.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');
const LINK = 'https://youtu.be/AAAAAAAAAAA?list=PLplaceholder&si=placeholderShare';

const setOnAir = (app: ElectronApplication, on: boolean) =>
  app.evaluate((_electron, value) => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(value);
  }, on);
const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());
const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The fake's downloads as its log tells them: its own process and its child's, each start. */
const fakeStarts = (log: string) =>
  (existsSync(log) ? readFileSync(log, 'utf8') : '')
    .split('\n')
    .filter((l) => l.startsWith('start download'))
    .map((l) => l.split(' '))
    .map((p) => ({ pid: Number(p[4]), child: Number(p[6]) }));

async function open(config: Record<string, unknown>, extra: Record<string, string> = {}) {
  const work = mkdtempSync(join(tmpdir(), 'drashti-youtube-e2e-'));
  const log = join(work, 'fake.log');
  const chosen = join(work, 'Chosen folder');
  const { app, userData } = await launchApp({
    DRASHTI_TEST_FAKE_YT_DLP: FAKE,
    DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
      log,
      title: 'Placeholder video',
      duration: 65,
      ...config,
    }),
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    ...extra,
  });
  const win = await operatorPage(app);
  // The smallest operator display Drashti is made for: the dialog must work at 1280 x 720.
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  await chooseMenuItem(app, 'import-from-link');
  await expect(win.getByTestId('link-dialog')).toBeVisible();
  return { app, win, userData, chosen, log };
}

test('YouTube: details, quality up to the setting, the tick each time, MP4 and MP3 saved and imported; on air holds it back', async () => {
  test.setTimeout(300_000);
  const { app, win, chosen, log } = await open({ steps: 24, stepMs: 150 }, { DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const dialog = win.getByTestId('link-dialog');

  // YouTube can be picked now.
  await expect(win.getByTestId('link-kind-youtube')).toBeEnabled();
  await win.getByTestId('link-kind-youtube').click();
  await expect(win.getByTestId('link-kind-youtube')).toHaveAttribute('aria-checked', 'true');

  // A playlist link is said plainly; a video's link from a playlist takes only the video.
  await win.getByTestId('link-text').fill('https://www.youtube.com/playlist?list=PLplaceholder');
  await expect(dialog).toContainText('That is a playlist. Drashti downloads one video at a time');
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  await expect(win.getByTestId('link-duration')).toHaveText(' (1:05)');
  await expect(win.getByTestId('link-holds')).toContainText('no adverts');
  expect((await view(win)).link).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA');

  // The heights it offers: above the admin's 1080p shown, but not to be picked, with why and where.
  for (const h of [4320, 2160, 1440])
    await expect(win.getByTestId(`link-quality-${String(h)}`)).toBeDisabled();
  for (const h of [1080, 720]) await expect(win.getByTestId(`link-quality-${String(h)}`)).toBeEnabled();
  await expect(win.getByTestId('link-quality-above')).toHaveText(
    'Above 1080p, the highest video quality an admin allows. An admin can change it under Highest video quality, above.',
  );
  await expect(win.getByTestId('link-quality-1080')).toHaveAttribute('aria-checked', 'true');
  await expect(win.getByTestId('link-quality-2160')).toContainText('2160p (4K)');

  // Download waits for the tick.
  const download = win.getByTestId('link-download');
  await expect(download).toBeDisabled();
  await win.getByTestId('link-permission').check();
  await expect(download).toBeEnabled();
  await win.getByTestId('link-choose-folder').click();
  await expect(win.getByTestId('link-folder')).toHaveText(chosen);
  await expectNoSeriousA11yIssues(
    win,
    'the Import from a Link dialog, YouTube',
    '[data-testid="link-dialog"]',
  );

  // Downloading; then on air: yt-dlp (and the child it started) stop, and it waits.
  await download.click();
  await expect
    .poll(async () => (await view(win)).progress?.done ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(3000);
  await expect(win.getByTestId('link-going-words')).toContainText('Downloading the MP4, 1080p');
  // While it goes, the choices step aside: the progress and Stop stay in view at 1280 x 720.
  await expect(win.getByTestId('link-youtube')).toHaveCount(0);
  await expect(win.getByTestId('link-stop')).toBeInViewport();
  await setOnAir(app, true);
  await expect(win.getByTestId('link-going')).toHaveAttribute('data-phase', 'waiting');
  const [first] = fakeStarts(log);
  expect(first).toBeDefined();
  await expect
    .poll(() => [first?.pid ?? 0, first?.child ?? 0].filter(alive), { timeout: 15_000 })
    .toEqual([]);
  await win.waitForTimeout(1500);
  expect(fakeStarts(log)).toHaveLength(1);
  // A part-file under a hidden name only: nothing under a real name yet.
  expect(readdirSync(chosen).every((n) => n.startsWith('.drashti-youtube-'))).toBe(true);
  // Off air: it starts again, carrying on from its part-file, and finishes.
  await setOnAir(app, false);
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });
  expect(fakeStarts(log)).toHaveLength(2);
  expect(readFileSync(log, 'utf8')).toMatch(/^resume \d+$/mu);
  expect(readdirSync(chosen)).toEqual(['Placeholder video.mp4']);
  await win.getByTestId('link-open-report').click();
  const report = win.getByTestId('import-report');
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  await expect(report.getByTestId('report-saved-in')).toContainText('Chosen folder');
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder video.mp4');

  // The same video as MP3: the tick again, then its sound alone.
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-another').click();
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  await win.getByTestId('link-type-mp3').click();
  await expect(win.getByTestId('link-mp3-words')).toContainText('The best sound the video has');
  await expect(win.getByTestId('link-quality-1080')).toHaveCount(0);
  await expect(win.getByTestId('link-permission')).not.toBeChecked();
  await expect(download).toBeDisabled();
  await win.getByTestId('link-permission').check();
  await download.click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 120_000 });
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder video.mp3', 'Placeholder video.mp4']);
  await win.getByTestId('link-open-report').click();
  await expect(report.getByTestId('report-item').first()).toHaveAttribute('data-outcome', 'imported');
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder video.mp3');
  await app.close();
});

test('YouTube: with the highest video quality at 2160p, 2160p can be picked (4320p still cannot)', async () => {
  test.setTimeout(180_000);
  const { app, win } = await open({});
  await win.getByTestId('link-max-height').selectOption('2160');
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  // The tallest the setting allows is chosen to begin with.
  await expect(win.getByTestId('link-quality-2160')).toBeEnabled();
  await expect(win.getByTestId('link-quality-2160')).toHaveAttribute('aria-checked', 'true');
  await expect(win.getByTestId('link-quality-4320')).toBeDisabled();
  await expect(win.getByTestId('link-quality-above')).toContainText('Above 2160p (4K)');
  await win.getByTestId('link-quality-1440').click();
  await expect(win.getByTestId('link-quality-1440')).toHaveAttribute('aria-checked', 'true');
  await win.getByTestId('link-quality-2160').click();
  await expect(win.getByTestId('link-quality-2160')).toHaveAttribute('aria-checked', 'true');
  // The arrow keys move among the qualities that can be picked, and the focus goes with them (the one above
  // the setting, listed first, is skipped).
  await win.getByTestId('link-quality-2160').focus();
  await win.keyboard.press('ArrowDown');
  await expect(win.getByTestId('link-quality-1440')).toHaveAttribute('aria-checked', 'true');
  await expect(win.getByTestId('link-quality-1440')).toBeFocused();
  await win.keyboard.press('End');
  await expect(win.getByTestId('link-quality-720')).toBeFocused();
  await win.keyboard.press('Home');
  await expect(win.getByTestId('link-quality-2160')).toBeFocused();
  await expect(win.getByTestId('link-quality-2160')).toHaveAttribute('aria-checked', 'true');
  await app.close();
});

test('YouTube: when yt-dlp fails, plain words with what to do next, never its own', async () => {
  test.setTimeout(120_000);
  const { app, win } = await open({
    failWith:
      'ERROR: [youtube] AAAAAAAAAAA: Private video. Sign in if you have been granted access to this video',
  });
  const dialog = win.getByTestId('link-dialog');
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(LINK);
  await expect(dialog).toContainText('Drashti never signs in to YouTube', { timeout: 60_000 });
  await expect(dialog).toContainText('YouTube Studio');
  await expect(dialog).not.toContainText('ERROR');
  await expect(dialog).not.toContainText('[youtube]');
  await expect(win.getByTestId('link-download')).toBeDisabled();
  await app.close();
});
