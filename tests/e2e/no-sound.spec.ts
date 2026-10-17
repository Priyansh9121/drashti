import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearOfShowControls } from './fit';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';

/*
 * No sound (Session 31), going live to FFmpeg listening for RTMP on this computer (nothing ever goes to
 * the internet), with Chromium's fake camera and microphone (its beep every half second) and a made-up
 * key. The quiet that raises it is 4 s here, not 20 (DRASHTI_TEST_NO_SOUND_MS); an unplugged microphone's
 * 3 s grace is the unit test's (src/main/stream/no-sound.test.ts), as nothing in a test can unplug one.
 */

const ffmpeg = testFfmpeg();
// CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const QUIET_MS = 4000;
const listeners: ChildProcess[] = [];

test.afterEach(() => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
});

const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());

/** The camera, and the microphone or none, for the stream (allowed on air, as Screens does it). */
async function inputs(win: Page, withMicrophone: boolean): Promise<void> {
  const r = await win.evaluate(async (mic) => {
    const d = (globalThis as PageGlobals).drashti;
    const s = await d.stream.status();
    const done = await d.stream.setInputs(
      s.inputs.cameras[0] ?? null,
      mic ? (s.inputs.microphones[0] ?? null) : null,
    );
    return done.ok ? 'ok' : done.message;
  }, withMicrophone);
  expect(r).toBe('ok');
}

/** Drashti's log lines that match. */
function logLines(userData: string, pattern: RegExp): string[] {
  const dir = join(userData, 'logs');
  return readdirSync(dir)
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
    .filter((l) => pattern.test(l));
}

test('No sound shows beside ON AIR, in Pro and Simple Mode, with no microphone; its notice never covers the show controls; a microphone clears it, and its beep raises nothing for 60 s', async () => {
  test.setTimeout(240_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-no-sound-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv')));
  const { app, userData } = await launchApp({
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_NO_SOUND_MS: String(QUIET_MS),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpStream(app, win, port, dir);
  // No microphone: what the stream sends is silence.
  await inputs(win, false);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true }));
  await expect.poll(async () => (await status(win)).live.state, { timeout: 45_000 }).toBe('live');
  // On air with no hall screen: the computer is kept awake for the stream (Session 31, ROB-7).
  const sleepHeld = () =>
    app.evaluate(
      () =>
        (globalThis as unknown as { drashtiDiagnostics: { sleepGuard: { held: boolean } } })
          .drashtiDiagnostics.sleepGuard.held,
    );
  expect(await sleepHeld()).toBe(true);
  // Within the quiet time and 2 s of going on air (the quiet is counted from the first sound encoded).
  try {
    await expect(win.getByTestId('no-sound')).toBeVisible({ timeout: QUIET_MS + 2000 });
  } catch (error) {
    console.log(
      `No sound did not show. The status: ${JSON.stringify((await status(win)).noSound)}; the stream's log:\n` +
        logLines(userData, /stream|[Ss]ound|[Ee]ncod/u)
          .slice(-40)
          .join('\n'),
    );
    throw error;
  }
  expect((await status(win)).noSound?.why).toBe('quiet');
  await win.getByRole('button', { name: 'Close stream' }).click();
  const notice = win.getByTestId('no-sound-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('No sound input is chosen for the stream');
  await clearOfShowControls(win, notice);

  // Simple Mode: the same, beside its own ON AIR.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  await expect(simple.getByTestId('on-air')).toBeVisible();
  await expect(simple.getByTestId('no-sound')).toBeVisible();
  await expect(simple.getByTestId('no-sound-notice')).toBeVisible();
  await clearOfShowControls(win, simple.getByTestId('no-sound-notice'));
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await expect(win.getByTestId('simple-mode')).toBeHidden();

  // A microphone (the fake one's beep): No sound goes, and the notice with it.
  await inputs(win, true);
  await expect(win.getByTestId('no-sound')).toBeHidden({ timeout: 10_000 });
  await expect(win.getByTestId('no-sound-notice')).toBeHidden();
  expect((await status(win)).noSound).toBeNull();

  // The beep, every half second, for 60 s: No sound never shows again, not even for a moment.
  await win.evaluate(() => {
    const w = globalThis as typeof globalThis & { noSoundSeen?: number };
    w.noSoundSeen = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="no-sound"]')) w.noSoundSeen = (w.noSoundSeen ?? 0) + 1;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const from = Date.now();
  let saidNoSound = 0;
  await expect
    .poll(
      async () => {
        if ((await status(win)).noSound) saidNoSound++;
        return Date.now() - from;
      },
      { timeout: 75_000, intervals: [1000] },
    )
    .toBeGreaterThanOrEqual(60_000);
  expect(saidNoSound, 'the status said No sound while the microphone beeped').toBe(0);
  expect(await win.evaluate(() => (globalThis as { noSoundSeen?: number }).noSoundSeen)).toBe(0);
  expect((await status(win)).live.state).toBe('live');

  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.end({ confirmed: true }));
  await expect.poll(sleepHeld).toBe(false);
  await app.close();
  // Said in the log once when it began and once when it ended, never every second.
  expect(logLines(userData, /No sound: /u)).toHaveLength(1);
  expect(logLines(userData, /The stream has sound again/u)).toHaveLength(1);
});
