import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { holdStill, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, readFlv, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';

/*
 * The stream's page is drawn off screen and captures its own picture (Session 18), for the operator's preview and
 * the encoder: nothing in the main process uses its frames. They never reach the main process (Session 58, C26):
 * where Chromium draws without a graphics chip each one was a whole picture copied into the main process, thirty
 * times a second, and the stream's next frame waited for it; with a chip, a texture made for it and let go at once.
 * Against FFmpeg listening for RTMP on this computer: nothing goes to the internet. Chromium's fake camera and
 * microphone (a picture that changes every frame) and a made-up key only.
 */

const ffmpeg = testFfmpeg();
// CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

let listener: ChildProcess | null = null;

test.afterEach(() => {
  listener?.kill('SIGKILL');
  listener = null;
});

test('on air, the stream’s page’s frames never reach the main process, and the stream gets them all the same', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-main-frames-'));
  const got = join(dir, 'received.flv');
  listener = rtmpListener(ffmpeg ?? '', port, got);
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // The fake camera in the Program: its picture changes every frame, so the page draws thirty a second.
  await setUpStream(app, win, port, dir);
  const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
  const on = await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true }));
  expect(on.ok).toBe(true);
  await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');

  // Every frame the Program window hands the main process, counted there from now on.
  const program = await app.evaluate(({ BrowserWindow }) => {
    const page = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('stream.html'));
    if (!page) return null;
    const counter = globalThis as { drashtiProgramFramesToMain?: number };
    counter.drashtiProgramFramesToMain = 0;
    page.webContents.on('paint', () => {
      counter.drashtiProgramFramesToMain = (counter.drashtiProgramFramesToMain ?? 0) + 1;
    });
    return { offscreen: page.webContents.isOffscreen() };
  });
  expect(program).toEqual({ offscreen: true });
  const toMain = () =>
    app.evaluate(
      () => (globalThis as { drashtiProgramFramesToMain?: number }).drashtiProgramFramesToMain ?? -1,
    );
  await holdStill(
    async () => (await toMain()) === 0,
    4000,
    'no frame of the stream’s page reaches the main process while its camera moves, on air',
  );
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('stream.html'))
        ?.webContents.isPainting(),
    ),
  ).toBe(false);
  // Still on air, and the stand-in for YouTube received the page's own frames (its capture, as before).
  expect((await status()).live.state).toBe('live');
  const ended = await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.end({ confirmed: true }));
  expect(ended.ok).toBe(true);
  await app.close();
  await expect.poll(() => existsSync(got) && statSync(got).size > 0).toBe(true);
  // Four seconds and more on air at thirty frames a second: at least fifteen a second arrived.
  expect(readFlv(got).videoFrames).toBeGreaterThan(60);
});
