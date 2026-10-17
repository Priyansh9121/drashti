import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearOfShowControls } from './fit';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * The stream's page crashing again and again (Session 31, ROB-7): it is started again at most 5 times a
 * minute, then left stopped with a notice and Try again, in Pro Mode and Simple Mode. A crash is played by
 * sending the page's own "render-process-gone", as Chromium does (Playwright cannot follow a page that really
 * crashes). It records meanwhile (into a temporary folder), as a crash on air or recording is the one that
 * matters. Chromium's fake camera and microphone only.
 */

// CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
test.skip(
  !testFfmpeg() && !process.env['CI'],
  'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs',
);

const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());

/** The stream's page ends as a crash ends it: false when there is none. */
const crash = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const page = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('stream.html'));
    if (!page) return false;
    page.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    return true;
  });

test('the stream’s page crashing a sixth time in a minute stays stopped, with a notice and Try again, in Pro and Simple Mode', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  let opened = 0;
  app.on('window', (p) => {
    if (p.url().includes('stream.html')) opened++;
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  // Recording: the stream's page is needed until it stops.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-page-stopped-'));
  await app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
  }, dir);
  const recording = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const folder = await d.stream.pickFolder();
    if (!folder.ok) return folder.message;
    const r = await d.stream.startRecording();
    return r.ok ? 'ok' : r.message;
  });
  expect(recording).toBe('ok');
  for (let i = 1; i <= 6; i++) {
    await expect.poll(async () => (await status(win)).programOn, { timeout: 20_000 }).toBe(true);
    expect(await crash(app)).toBe(true);
  }
  // Five times it came back; the sixth time it stays stopped, and says so.
  await expect.poll(async () => (await status(win)).pageStopped).toBe(true);
  const notice = win.getByTestId('stream-page-stopped-notice');
  await expect(notice).toBeVisible();
  await clearOfShowControls(win, notice);
  const pagesBefore = opened;
  // No seventh page, however long.
  const from = Date.now();
  await expect
    .poll(() => Date.now() - from, { timeout: 10_000, intervals: [500] })
    .toBeGreaterThanOrEqual(3000);
  expect(opened).toBe(pagesBefore);
  expect((await status(win)).programOn).toBe(false);
  // Simple Mode shows it too, and its Try again brings the page back.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const simple = win.getByTestId('simple-mode');
  await expect(simple.getByTestId('stream-page-stopped-notice')).toBeVisible();
  await simple.getByTestId('stream-page-try-again').click();
  await expect.poll(async () => (await status(win)).programOn, { timeout: 20_000 }).toBe(true);
  await expect(win.getByTestId('stream-page-stopped-notice')).toBeHidden();
  expect((await status(win)).pageStopped).toBe(false);
  const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  expect(log).toContain('for the sixth time in a minute');
  expect(log).toContain("The stream's page is tried again");
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording());
  await app.close();
});
