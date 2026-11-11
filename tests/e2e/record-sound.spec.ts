import { expect, test } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream, streamPage, testFfmpeg } from './stream-helpers';

test('Record sound off air saves generated audio and adds a draft only when captions run', async () => {
  test.setTimeout(90_000);
  const folder = test.info().outputPath('recordings');
  await mkdir(folder, { recursive: true });
  const { app } = await launchApp({
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_SPEECH: 'Test tone',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, await freePort(), folder);
    const stream = win.getByTestId('stream-panel');
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    const soundFiles = async (suffix: string) => (await readdir(folder)).filter((f) => f.endsWith(suffix));

    const recordSound = async () => {
      await stream.getByRole('button', { name: 'Record', exact: true }).click();
      const menu = win.getByRole('menu', { name: 'Record', exact: true });
      await expect(menu.getByRole('menuitem').first()).toHaveText('Record sound');
      await menu.getByRole('menuitem', { name: 'Record sound', exact: true }).click();
      await expect.poll(status).toMatchObject({
        live: { state: 'off' },
        recording: { state: 'recording', kind: 'sound' },
        encoder: null,
      });
    };
    const stopSound = async () => {
      await stream.getByRole('button', { name: 'Stop sound recording' }).click();
      await expect.poll(status).toMatchObject({ recording: { state: 'off' } });
    };

    await recordSound();
    await stopSound();
    const files = await soundFiles('.wav');
    expect(files).toHaveLength(1);
    expect(await soundFiles('.draft.vtt')).toEqual([]);
    const wave = await readFile(join(folder, files[0] ?? ''));
    expect(wave.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wave.readUInt32LE(40)).toBeGreaterThan(0);
    expect(wave.length).toBe(wave.readUInt32LE(40) + 44);

    await win.evaluate(() => (globalThis as PageGlobals).drashti.captions.setOn(true));
    await recordSound();
    // The draft keeps only the words heard after the recording began, so a first phrase heard across its start comes
    // in cut ("tone"); the stand-in hears the whole phrase again every 1.5 s (Session 56: a slow Windows VM stopped on
    // the cut one). Stop once a whole phrase is in.
    const draftText = async () => {
      const [file] = await soundFiles('.draft.vtt');
      return file ? readFile(join(folder, file), 'utf8') : '';
    };
    await expect.poll(draftText).toMatch(/\d:\d\d\.\d\d\d --> .*\nTest tone/u);
    await stopSound();
    const [draft] = await soundFiles('.draft.vtt');
    expect(await soundFiles('.wav')).toContain(draft?.replace(/\.draft\.vtt$/u, '.wav'));
    expect(await readFile(join(folder, draft ?? ''), 'utf8')).toMatch(/\d:\d\d\.\d\d\d --> .*\nTest tone/u);
    await expect(win.getByTestId('on-air')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Simple Mode records locally with the Pro Mode folder and cannot change it', async () => {
  test.setTimeout(90_000);
  const folder = test.info().outputPath('recordings');
  await mkdir(folder, { recursive: true });
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, await freePort(), folder);
    const preview = await streamPage(app);
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    const menu = win.getByRole('menu', { name: 'Record', exact: true });
    await win.getByTestId('stream-panel').getByRole('button', { name: 'Record', exact: true }).click();
    await expect(menu.getByRole('menuitem', { name: 'Change recording folder…' })).toBeVisible();
    await win.keyboard.press('Escape');
    await win.getByRole('button', { name: 'Close stream' }).click();
    await expect.poll(() => preview.isClosed()).toBe(true);
    await win.getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.pickFolder())).toEqual({
      ok: false,
      message: SIMPLE_MODE_REFUSAL,
    });
    await simple.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(menu.getByRole('menuitem')).toHaveText(['Record sound', 'Record video']);

    // Make the new Program receive its saved input before the fake devices are listed.
    const delayedDevices = await app.context().addInitScript(() => {
      if (!location.pathname.endsWith('/stream.html')) return;
      const devices = navigator.mediaDevices;
      const enumerate = devices.enumerateDevices.bind(devices);
      const ready = new Promise<void>((resolve) => {
        window.addEventListener('drashti-test-list-devices', () => resolve(), { once: true });
      });
      devices.enumerateDevices = async () => {
        document.documentElement.dataset['testDevicesDelayed'] = 'yes';
        await ready;
        return enumerate();
      };
    });
    await menu.getByRole('menuitem', { name: 'Record sound', exact: true }).click();
    const program = await streamPage(app);
    const programRoot = program.getByTestId('program-root');
    await expect(program.locator('html')).toHaveAttribute('data-test-devices-delayed', 'yes');
    await expect(programRoot).toHaveAttribute('data-layout', /^(camera|slides)$/u);
    await program.evaluate(() => window.dispatchEvent(new Event('drashti-test-list-devices')));
    await delayedDevices.dispose();
    await expect(programRoot).toHaveAttribute('data-sound', 'on');
    await expect.poll(status).toMatchObject({
      live: { state: 'off' },
      recording: { state: 'recording', kind: 'sound', folder },
    });
    await simple.getByRole('button', { name: 'Stop sound recording' }).click();
    await expect.poll(status).toMatchObject({ recording: { state: 'off', folder } });

    if (testFfmpeg()) {
      await simple.getByRole('button', { name: 'Record', exact: true }).click();
      await menu.getByRole('menuitem', { name: 'Record video', exact: true }).click();
      await expect.poll(status, { timeout: 20_000 }).toMatchObject({
        live: { state: 'off' },
        recording: { state: 'recording', kind: 'video', folder },
      });
      await simple.getByRole('button', { name: 'Stop video recording' }).click();
      await expect.poll(status).toMatchObject({ recording: { state: 'off', folder } });
    }
  } finally {
    await app.close();
  }
});
