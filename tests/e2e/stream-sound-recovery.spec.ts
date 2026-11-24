import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loudWindows, readSound, soundSeconds } from './av-sync';
import { clearOfShowControls } from './fit';
import { launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream, testFfmpeg } from './stream-helpers';

/**
 * Sound, in a 50 ms window of the recording: a sample this loud (-34 dBFS) at least. The generated microphone's beeps
 * are far louder; the silence the encoder fills in while no sound comes is nothing at all.
 */
const HEARD = 0.02;

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
    // The encoder is writing before the first crash: each restart's sound must come by the new page's own pairing,
    // never by the encoder's first start pairing whichever page is there then.
    await expect.poll(async () => (await status()).recording.bytes, { intervals: [50] }).toBeGreaterThan(0);
    // The file's own start, on this computer's clock: it began at most this long ago. Never `since`: the encoder starts
    // on the page's first frame of the show, which came 5 s after the recording began on CI's Mac
    // (a22-fade-1124-145657-55108), so a window placed from `since` fell 5 s late, past the next crash.
    const fileSeenAt = Date.now();
    const recording = (await status()).recording;
    // a22-review-x86 M2: after an ordinary restart, the sound itself reaches the recording again (not only a microphone
    // that opened): read back from the file afterwards, from this moment on.
    let restartedAt = 0;
    for (let crash = 0; crash < 6; crash++) {
      await expect.poll(async () => (await status()).inputs.sound).toBe('on');
      if (crash === 1) {
        restartedAt = Date.now();
        await letTimePass(win, 5000, 'the restarted sound page’s sound reaches the recording');
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
    await letTimePass(win, 4500, 'the sound page started again by Try again reaches the recording');
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.state).toBe('off');
    const files = readdirSync(dir).filter((f) => f.endsWith('.mkv'));
    expect(files, 'one recording through every sound crash').toHaveLength(1);
    const sound = readSound(ffmpeg ?? '', join(dir, files[0] ?? ''));
    // The restart is placed from the file's own start (seen up to about a second after it began, so the restart lies at
    // or a little after this), Try again from the file's own end. While no sound comes the encoder fills silence, so the
    // file keeps up with this computer's clock to within a few tenths of a second for each crash. The restart's sound
    // runs 5 s, until the next crash.
    const fromRestart = sound.start + (restartedAt - fileSeenAt) / 1000;
    const end = sound.start + soundSeconds(sound);
    console.log(
      `Sound in the recording (50 ms windows): after a restart ${String(loudWindows(sound, fromRestart + 0.5, fromRestart + 4, HEARD))}, after Try again ${String(loudWindows(sound, end - 3.5, end - 0.5, HEARD))}`,
    );
    expect(
      loudWindows(sound, fromRestart + 0.5, fromRestart + 4, HEARD),
      'the sound reaches the recording again after a sound page restart',
    ).toBeGreaterThanOrEqual(2);
    expect(
      loudWindows(sound, end - 3.5, end - 0.5, HEARD),
      'the sound reaches the recording again after Try again',
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
});
