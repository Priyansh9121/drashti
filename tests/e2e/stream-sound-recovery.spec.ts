import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { clearOfShowControls } from './fit';
import { launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream, testFfmpeg } from './stream-helpers';

/** Each 50 ms of a recording's sound, mono at 48 kHz: its loudest sample (the generated microphone only). */
function soundPeaks(ffmpeg: string, file: string): number[] {
  const decoded = spawnSync(
    ffmpeg,
    ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (decoded.status !== 0) throw new Error('The generated recording could not be read back');
  const pcm = decoded.stdout,
    size = 2400,
    peaks: number[] = [];
  for (let at = 0; at + size * 4 <= pcm.length; at += size * 4) {
    let peak = 0;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(pcm.readFloatLE(at + i * 4)));
    peaks.push(peak);
  }
  return peaks;
}

// Alpha.22: run on both systems after alpha.21 PUBLISHED. Generated devices and local recording only.
test('stream sound recovers independently, caps its sixth crash, and Try again preserves the picture and recording', async () => {
  const ffmpeg = testFfmpeg();
  expect(ffmpeg, 'CI supplies the bundled encoder').not.toBeNull();
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = test.info().outputPath('recordings');
    await mkdir(dir, { recursive: true });
    await setUpStream(app, win, await freePort(), dir, false);
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    const pages = () =>
      app.evaluate(({ BrowserWindow }) => {
        const page = (name: string) => {
          const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(name));
          return window ? { id: window.webContents.id, pid: window.webContents.getOSProcessId() } : null;
        };
        return { picture: page('/stream.html'), sound: page('/stream-sound.html') };
      });
    await expect.poll(async () => (await status()).inputs.sound).toBe('on');
    const picturePage = app.windows().find((page) => page.url().includes('/stream.html'));
    if (!picturePage) throw new Error('The generated picture page did not open');
    const originalInputIds = await picturePage.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter(
          (device) =>
            device.kind === 'audioinput' &&
            device.deviceId !== '' &&
            device.deviceId !== 'default' &&
            device.deviceId !== 'communications',
        )
        .map((device) => device.deviceId)
        .sort(),
    );
    expect(
      (await status()).inputs.microphones.map((device) => device.id).sort(),
      'the sound renderer preserves the original stream device-id namespace',
    ).toEqual(originalInputIds);
    const before = await pages();
    expect(before.picture).not.toBeNull();
    expect(before.sound).not.toBeNull();
    expect(before.sound?.pid).not.toBe(before.picture?.pid);
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.state).toBe('recording');
    const recording = (await status()).recording;
    // a22-review-x86 M2: after an ordinary restart, the sound itself reaches the recording again (not only a microphone
    // that opened): read back from the file afterwards, from this moment on.
    let restartedAt = 0;
    for (let crash = 0; crash < 6; crash++) {
      await expect.poll(async () => (await status()).inputs.sound).toBe('on');
      if (crash === 1) {
        restartedAt = Date.now();
        await letTimePass(win, 3500, 'the restarted sound page’s sound reaches the recording');
      }
      expect(
        await app.evaluate(({ BrowserWindow }) => {
          const sound = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('/stream-sound.html'),
          );
          if (!sound) return false;
          sound.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
          return true;
        }),
      ).toBe(true);
      expect((await pages()).picture).toEqual(before.picture);
      expect((await status()).recording).toMatchObject({
        state: 'recording',
        since: recording.since,
        file: recording.file,
      });
    }
    await expect.poll(async () => (await status()).soundPageStopped).toBe(true);
    expect((await status()).pageStopped).toBe(false);
    const notice = win.getByTestId('stream-page-stopped-notice');
    await expect(notice).toContainText('The stream’s sound has stopped');
    await clearOfShowControls(win, notice);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    const simple = win.getByTestId('simple-mode');
    await expect(simple.getByTestId('stream-page-stopped-notice')).toBeVisible();
    await simple.getByTestId('stream-page-try-again').click();
    await expect.poll(async () => (await status()).inputs.sound).toBe('on');
    await expect(notice).toBeHidden();
    const after = await pages();
    expect(after.picture).toEqual(before.picture);
    expect(after.sound?.id).not.toBe(before.sound?.id);
    expect(after.sound?.pid).not.toBe(after.picture?.pid);
    expect((await status()).recording).toMatchObject({
      state: 'recording',
      since: recording.since,
      file: recording.file,
    });
    // M2 again: after Try again, the sound reaches the recording to its end.
    await letTimePass(win, 3500, 'the sound page started again by Try again reaches the recording');
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.state).toBe('off');
    const files = readdirSync(dir).filter((f) => f.endsWith('.mkv'));
    expect(files, 'one recording through every sound crash').toHaveLength(1);
    const peaks = soundPeaks(ffmpeg ?? '', join(dir, files[0] ?? ''));
    const loudest = Math.max(0, ...peaks);
    expect(loudest, 'the generated microphone is in the recording').toBeGreaterThan(0.01);
    /** How many 50 ms windows carry the generated microphone's beep (each half second) in this stretch (ms in). */
    const beeps = (fromMs: number, toMs: number) =>
      peaks
        .slice(Math.max(0, Math.floor(fromMs / 50)), Math.ceil(toMs / 50))
        .filter((p) => p >= loudest * 0.3).length;
    const since = recording.since ?? 0;
    expect(
      beeps(restartedAt - since + 500, restartedAt - since + 3000),
      'the sound reaches the recording again after a sound page restart',
    ).toBeGreaterThanOrEqual(2);
    expect(
      beeps((peaks.length - 60) * 50, (peaks.length - 6) * 50),
      'the sound reaches the recording again after Try again',
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
});
