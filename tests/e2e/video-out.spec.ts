import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdStill, launchApp, operatorPage, operatorReady, type PageGlobals, relaunchApp } from './helpers';

/*
 * Video out (x30, prompt 11; the owner's "Go, all A"): the stream's picture to other apps on this computer, by Syphon
 * on a Mac and Spout on Windows, off until someone turns it on. The first two tests use the stand-in receiver (the
 * video-out process writes what it receives to a file: DRASHTI_TEST_VIDEO_OUT_STAND_IN, honoured only when Drashti is
 * not packaged); the last sends for real, read back by the tests' own receiver on this runner (a Syphon client, a
 * Spout receiver: scripts/fetch-video-out.mjs builds it beside the sender), never anything over a network. That the
 * picture arrives the right way up, in each format the stream's page gives, scripts/check-video-out.mjs checks with
 * generated frames.
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };

interface Seen {
  name: string;
  frames: number;
  width: number;
  height: number;
  middle: [number, number, number];
}

/** What the stand-in receiver has written, or null (nothing yet, or a write caught half done). */
function seen(file: string): Seen | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Seen;
  } catch {
    return null;
  }
}

const red = (s: Seen | null) => !!s && s.middle[0] > 150 && s.middle[1] < 90 && s.middle[2] < 90;
const blue = (s: Seen | null) => !!s && s.middle[2] > 150 && s.middle[0] < 90 && s.middle[1] < 90;

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

const background = (color: string) =>
  ({ type: 'setBackground', background: { kind: 'color', color } }) as const;

function streamStatus(win: Page) {
  return win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
}

function videoOut(win: Page) {
  return win.evaluate(() => (globalThis as PageGlobals).drashti.stream.videoOut());
}

/** Whether Drashti's video-out process is running. */
function videoOutProcess(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ app: a }) =>
    a.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti video out'),
  );
}

test('video out is off until it is turned on; on, the stand-in receiver gets the stream’s picture as it changes; off, nothing is left', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-out-'));
  const file = join(dir, 'seen.json');
  try {
    const { app } = await launchApp({ ...FAKE, DRASHTI_TEST_VIDEO_OUT_STAND_IN: file });
    const win = await operatorPage(app);
    await operatorReady(win);
    // Off as it starts: no process, nothing received.
    expect(await videoOut(win)).toMatchObject({
      settings: { on: false, name: 'Drashti' },
      state: 'off',
      way: 'stand-in',
      frames: 0,
    });
    await holdStill(
      async () => !(await videoOutProcess(app)) && !existsSync(file),
      2000,
      'off: no video-out process, nothing received',
    );

    // The stream's picture: its Slides layout over red, nothing on air.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
    await dispatch(win, background('#c81e1e'));
    await win.getByTestId('open-stream').click();
    await win.getByTestId('open-stream-settings').click();
    const toggle = win.getByTestId('video-out-switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => videoOutProcess(app), { timeout: 15_000 }).toBe(true);

    // Received at the stream's size, red, under its name, and said so.
    await expect.poll(() => seen(file)?.width ?? 0, { timeout: 30_000 }).toBe(1920);
    expect(seen(file)).toMatchObject({ name: 'Drashti', width: 1920, height: 1080 });
    await expect.poll(() => red(seen(file)), { timeout: 15_000 }).toBe(true);
    await expect(win.getByTestId('video-out-state')).toHaveAttribute('data-state', 'sending');
    // It follows the picture.
    await dispatch(win, background('#1e1ec8'));
    await expect.poll(() => blue(seen(file)), { timeout: 15_000 }).toBe(true);
    // The stream itself as it was: neither on air nor recording.
    const status = await streamStatus(win);
    expect([status.live.state, status.recording.state, status.layout]).toEqual(['off', 'off', 'slides']);

    // Off: the process ends, nothing more is received, and with the panels closed the stream's page goes.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => videoOutProcess(app), { timeout: 15_000 }).toBe(false);
    await expect(win.getByTestId('video-out-state')).toHaveAttribute('data-state', 'off');
    const last = seen(file)?.frames ?? -1;
    await dispatch(win, background('#c81e1e'));
    await holdStill(() => (seen(file)?.frames ?? -1) === last, 1500, 'off: nothing more received');
    await win.getByRole('button', { name: 'Close stream settings' }).click();
    await win.getByRole('button', { name: 'Close stream' }).click();
    await expect.poll(async () => (await streamStatus(win)).programOn, { timeout: 15_000 }).toBe(false);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('video out left on is on again after a restart, under its name; Simple Mode cannot change it', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-out-'));
  const file = join(dir, 'seen.json');
  try {
    const first = await launchApp({ ...FAKE, DRASHTI_TEST_VIDEO_OUT_STAND_IN: file });
    const win = await operatorPage(first.app);
    await operatorReady(win);
    expect(
      await win.evaluate(() =>
        (globalThis as PageGlobals).drashti.stream.setVideoOut({ on: true, name: 'Sabha hall' }),
      ),
    ).toMatchObject({ ok: true, status: { settings: { on: true, name: 'Sabha hall' } } });
    await expect.poll(() => seen(file)?.name, { timeout: 30_000 }).toBe('Sabha hall');
    await first.app.close();
    rmSync(file, { force: true });

    // Started again: sending at once, nothing opened by hand.
    const second = await relaunchApp(first.userData, { ...FAKE, DRASHTI_TEST_VIDEO_OUT_STAND_IN: file });
    const win2 = await operatorPage(second.app);
    await operatorReady(win2);
    await expect.poll(() => seen(file)?.frames ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(seen(file)?.name).toBe('Sabha hall');
    expect(await videoOut(win2)).toMatchObject({
      settings: { on: true, name: 'Sabha hall' },
      state: 'sending',
    });

    // Simple Mode: refused from the window, and it goes on sending.
    await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win2.getByTestId('simple-mode')).toBeVisible();
    expect(
      await win2.evaluate(() =>
        (globalThis as PageGlobals).drashti.stream.setVideoOut({ on: false, name: 'Sabha hall' }),
      ),
    ).toMatchObject({ ok: false });
    expect(await videoOut(win2)).toMatchObject({ settings: { on: true } });
    expect(await videoOutProcess(second.app)).toBe(true);
    await second.app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The tests' receiver for this computer's way, built beside the sender by scripts/fetch-video-out.mjs. */
function receiverProgram(): string {
  const exe = process.platform === 'win32' ? 'drashti-video-out-receiver.exe' : 'drashti-video-out-receiver';
  return join(process.cwd(), 'vendor', 'video-out', `${process.platform}-${process.arch}`, exe);
}

test('turned on, Syphon on a Mac and Spout on Windows give a receiver on this computer the stream’s picture as it changes; off, it stops', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-out-'));
  const file = join(dir, 'received.json');
  const name = 'Drashti e2e';
  let receiver: ChildProcess | null = null;
  try {
    const program = receiverProgram();
    expect(
      existsSync(program),
      `the tests' receiver is built (node scripts/fetch-video-out.mjs): ${program}`,
    ).toBe(true);
    receiver = spawn(program, ['--name', name, '--out', file], { stdio: 'ignore', windowsHide: true });
    const { app } = await launchApp(FAKE);
    const win = await operatorPage(app);
    await operatorReady(win);
    // This computer's way, offered and off.
    expect(await videoOut(win)).toMatchObject({
      settings: { on: false },
      state: 'off',
      way: process.platform === 'darwin' ? 'syphon' : 'spout',
    });
    // The stream's picture over red, then turned on from Stream settings under the receiver's name.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
    await dispatch(win, background('#c81e1e'));
    await win.getByTestId('open-stream').click();
    await win.getByTestId('open-stream-settings').click();
    const nameField = win.getByTestId('video-out-name');
    await nameField.fill(name);
    await nameField.press('Enter');
    await win.getByTestId('video-out-switch').click();
    await expect(win.getByTestId('video-out-switch')).toHaveAttribute('aria-checked', 'true');

    // Read back on this computer: the stream's size, red, then blue as the picture changes.
    await expect.poll(() => seen(file)?.width ?? 0, { timeout: 45_000 }).toBe(1920);
    expect(seen(file)).toMatchObject({ name, width: 1920, height: 1080 });
    await expect.poll(() => red(seen(file)), { timeout: 15_000 }).toBe(true);
    await expect(win.getByTestId('video-out-state')).toHaveAttribute('data-state', 'sending');
    await dispatch(win, background('#1e1ec8'));
    await expect.poll(() => blue(seen(file)), { timeout: 15_000 }).toBe(true);
    // Off: the sender ends, and nothing more arrives.
    await win.getByTestId('video-out-switch').click();
    await expect(win.getByTestId('video-out-state')).toHaveAttribute('data-state', 'off');
    await expect.poll(() => videoOutProcess(app), { timeout: 15_000 }).toBe(false);
    const last = seen(file)?.frames ?? -1;
    await dispatch(win, background('#c81e1e'));
    await holdStill(() => (seen(file)?.frames ?? -1) === last, 2000, 'off: nothing more received');
    await app.close();
  } finally {
    receiver?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
