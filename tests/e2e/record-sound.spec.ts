import { expect, test } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, setUpStream } from './stream-helpers';

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
    await expect.poll(() => soundFiles('.draft.vtt')).toHaveLength(1);
    await stopSound();
    const [draft] = await soundFiles('.draft.vtt');
    expect(await soundFiles('.wav')).toContain(draft?.replace(/\.draft\.vtt$/u, '.wav'));
    expect(await readFile(join(folder, draft ?? ''), 'utf8')).toMatch(/\d:\d\d\.\d\d\d --> .*\nTest tone/u);
    await expect(win.getByTestId('on-air')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
