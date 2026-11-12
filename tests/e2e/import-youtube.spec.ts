import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { linkFinished, linkView as view, pasteLink } from './paste-link';
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
  const chosen = join(work, 'Videos', 'Drashti downloads');
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
  await win.setViewportSize({ width: 1024, height: 645 });
  await operatorReady(win);
  await chooseMenuItem(app, 'import-from-link');
  await expect(win.getByTestId('link-paste')).toBeVisible();
  return { app, win, userData, chosen, log };
}

test('YouTube: a paste downloads video at 1080p, or sound from Audio; going on air pauses a download', async () => {
  test.setTimeout(300_000);
  const { app, win, chosen, log } = await open({ steps: 60, stepMs: 150 }, { DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const field = win.getByTestId('link-paste');
  await expectNoSeriousA11yIssues(win, 'the YouTube link input', '[data-testid="link-paste"]');
  await pasteLink(win, 'https://www.youtube.com/playlist?list=PLplaceholder', false);
  await expect(win.getByTestId('import-notice')).toContainText(
    'That is a playlist. Drashti downloads one video at a time',
  );
  await pasteLink(win, LINK);
  await expect(field).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  const status = win.getByTestId('link-status');

  // Downloading; then on air: yt-dlp (and the child it started) stop, and it waits.
  await expect
    .poll(async () => (await view(win)).progress?.done ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(3000);
  await expect(status).toContainText('Downloading from YouTube');
  expect(await view(win)).toMatchObject({
    link: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    choice: { type: 'mp4', height: 1080 },
  });
  await expect(win.getByTestId('link-stop')).toBeInViewport();
  await setOnAir(app, true);
  await expect(status).toHaveAttribute('data-phase', 'waiting');
  const [first] = fakeStarts(log);
  expect(first).toBeDefined();
  await expect
    .poll(() => [first?.pid ?? 0, first?.child ?? 0].filter(alive), { timeout: 15_000 })
    .toEqual([]);
  await holdStill(() => fakeStarts(log).length === 1, 1500, 'on air, yt-dlp is not started again');
  // A part-file under a hidden name only: nothing under a real name yet.
  expect(readdirSync(chosen).every((n) => n.startsWith('.drashti-youtube-'))).toBe(true);
  // Off air: it starts again, carrying on from its part-file, and finishes.
  await setOnAir(app, false);
  await linkFinished(win);
  expect(fakeStarts(log)).toHaveLength(2);
  expect(readFileSync(log, 'utf8')).toMatch(/^resume \d+$/mu);
  expect(readdirSync(chosen)).toEqual(['Placeholder video.mp4']);
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder video.mp4');

  // The same video from Audio takes its sound, and adds it to the audio playlist.
  await win.getByTestId('music-empty').getByRole('button', { name: 'From a Link…' }).click();
  await pasteLink(win, LINK);
  await linkFinished(win);
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder video.mp3', 'Placeholder video.mp4']);
  expect((await view(win)).choice).toEqual({ type: 'mp3', height: null });
  await expect.poll(async () => (await listMedia(win)).map((m) => m.name)).toContain('Placeholder video.mp3');
  await expect
    .poll(async () =>
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.music.view())).playlists.flatMap((p) =>
        p.tracks.map((t) => t.name),
      ),
    )
    .toEqual(['Placeholder video.mp3']);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await app.close();
});

test('YouTube: on air, looking at a link waits; a look going stops (yt-dlp and its child) and looks again afterwards', async () => {
  test.setTimeout(180_000);
  const { app, win, log } = await open({ lookMs: 10_000 }, { DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const looking = win.getByTestId('link-status');
  const looks = () =>
    (existsSync(log) ? readFileSync(log, 'utf8') : '')
      .split('\n')
      .filter((l) => l.startsWith('start look'))
      .map((l) => l.split(' '))
      .map((p) => ({ pid: Number(p[4]), child: Number(p[6]) }));
  // On air: the link is checked, but nothing of YouTube's runs; the dialog says it waits, as a download does.
  await setOnAir(app, true);
  await pasteLink(win, LINK);
  await expect(looking).toContainText('Link check waits while the stream is in use');
  await holdStill(() => looks().length === 0, 1500, 'on air, the link is not looked at');
  // Off air: it looks. On air again while it looks: yt-dlp (and the child it started) stop, and it waits.
  await setOnAir(app, false);
  await expect.poll(() => looks().length, { timeout: 30_000 }).toBe(1);
  await expect(looking).toContainText('Checking link…');
  await setOnAir(app, true);
  await expect(looking).toContainText('Link check waits while the stream is in use');
  const [first] = looks();
  await expect
    .poll(() => [first?.pid ?? 0, first?.child ?? 0].filter(alive), { timeout: 15_000 })
    .toEqual([]);
  await holdStill(() => looks().length === 1, 1500, 'on air again, it does not look again');
  expect((await view(win)).look).toBeNull();
  // Off air: it looks again and imports automatically.
  await setOnAir(app, false);
  await linkFinished(win);
  expect(looks()).toHaveLength(2);
  expect((await view(win)).look?.name).toBe('Placeholder video');
  await app.close();
});

test('YouTube: the paste takes the best quality below 1080p when 1080p is unavailable', async () => {
  test.setTimeout(180_000);
  const { app, win } = await open({ heights: [360, 720, 1440, 2160] });
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.links.setMaxHeight(2160)),
  ).toMatchObject({
    ok: true,
  });
  await pasteLink(win, LINK);
  await linkFinished(win);
  expect((await view(win)).choice).toEqual({ type: 'mp4', height: 720 });
  await app.close();
});

test('YouTube: when yt-dlp fails, plain words with what to do next, never its own', async () => {
  test.setTimeout(120_000);
  const { app, win } = await open({
    failWith:
      'ERROR: [youtube] AAAAAAAAAAA: Private video. Sign in if you have been granted access to this video',
  });
  await pasteLink(win, LINK);
  const notice = win.getByTestId('import-notice');
  await expect(notice).toContainText('Drashti never signs in to YouTube', { timeout: 60_000 });
  await expect(notice).toContainText('YouTube Studio');
  await expect(notice).not.toContainText('ERROR');
  await expect(notice).not.toContainText('[youtube]');
  await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await app.close();
});
