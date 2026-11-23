import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clearOfShowControls } from './fit';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream, testFfmpeg } from './stream-helpers';

// Alpha.22: run on both systems after alpha.21 PUBLISHED. Generated devices and local recording only.
test('stream sound recovers independently, caps its sixth crash, and Try again preserves the picture and recording', async () => {
  expect(testFfmpeg(), 'CI supplies the bundled encoder').not.toBeNull();
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
    const before = await pages();
    expect(before.picture).not.toBeNull();
    expect(before.sound).not.toBeNull();
    expect(before.sound?.pid).not.toBe(before.picture?.pid);
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.state).toBe('recording');
    const recording = (await status()).recording;
    for (let crash = 0; crash < 6; crash++) {
      await expect.poll(async () => (await status()).inputs.sound).toBe('on');
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
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
  } finally {
    await app.close();
  }
});
