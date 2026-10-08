import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MkvCluster } from '../../src/main/stream/worker/mkv';
import { MkvSplitter } from '../../src/main/stream/worker/mkv';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { StreamStatus } from '../../src/shared/stream';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  relaunchApp,
  type PageGlobals,
} from './helpers';
import { freePort, readFlv, rtmpListener, TEST_KEY, testFfmpeg } from './stream-helpers';

/*
 * Going live and recording, against FFmpeg listening for RTMP on this
 * computer: nothing ever goes to YouTube or anywhere else on the internet.
 * Chromium's fake camera and microphone, generated pictures, placeholder
 * words, and a made-up key only.
 */

const ffmpeg = testFfmpeg();
// CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
const listeners: ChildProcess[] = [];

test.afterEach(() => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
});

const bridge = (win: Page) => ({
  status: () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status()),
});

async function streamPage(app: ElectronApplication): Promise<Page> {
  const isStream = (p: Page) => p.url().includes('stream.html');
  return app.windows().find(isStream) ?? app.waitForEvent('window', { predicate: isStream });
}

/** The profile in use sends to the local listener, with the fake camera (or none) and microphone and the test key. */
async function setUp(
  app: ElectronApplication,
  win: Page,
  port: number,
  folder: string,
  withCamera = true,
): Promise<void> {
  await app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
  }, folder);
  await win.getByTestId('open-stream').click();
  await streamPage(app);
  await expect
    .poll(async () => {
      const s = await bridge(win).status();
      return s.inputs.cameras.length > 0 && s.inputs.microphones.length > 0;
    })
    .toBe(true);
  const result = await win.evaluate(
    async ({ port, key, withCamera }) => {
      const d = (globalThis as PageGlobals).drashti;
      const s = await d.stream.status();
      const { profiles, activeId } = await d.stream.profiles();
      const p = profiles.find((x) => x.id === activeId);
      if (!p) return 'no profile';
      const saved = await d.stream.saveProfile(p.id, {
        name: 'Local test',
        url: `rtmp://127.0.0.1:${port}/live2`,
        preset: 'weak',
        camera: withCamera ? (s.inputs.cameras[0] ?? null) : null,
        sound: s.inputs.microphones[0] ?? null,
        soundDelayMs: 0,
        mixOwnSound: false,
      });
      if (!saved.ok) return saved.message;
      const kept = await d.stream.setKey(p.id, key);
      if (!kept.ok) return kept.message;
      const folder = await d.stream.pickFolder();
      return folder.ok ? 'ok' : folder.message;
    },
    { port, key: TEST_KEY, withCamera },
  );
  expect(result).toBe('ok');
}

const live = (s: StreamStatus) => s.live.state;

/** The stream's lines from Drashti's log (already without the key), to see why a wait failed. */
function streamLog(userData: string): string {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return '(no log)';
  return readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
    .split('\n')
    .filter((l) => /stream|encoder|Program|[Rr]ecording/u.test(l))
    .slice(-60)
    .join('\n');
}

/** Wait for the stream to be in this state; on failure, show the stream's log. */
async function waitLive(
  win: Page,
  userData: string,
  state: StreamStatus['live']['state'],
  timeout = 45_000,
): Promise<void> {
  try {
    await expect.poll(async () => live(await bridge(win).status()), { timeout }).toBe(state);
  } catch (error) {
    console.log(`The stream did not reach ${state}. Its log:\n${streamLog(userData)}`);
    throw error;
  }
}

/** A recording's clusters, read back as a player would. */
function readRecording(file: string): {
  header: boolean;
  clusters: MkvCluster[];
  seconds: number[];
  bytes: number;
} {
  let header = false;
  const clusters: MkvCluster[] = [];
  const splitter = new MkvSplitter(
    () => {
      header = true;
    },
    (c) => clusters.push(c),
  );
  const bytes = readFileSync(file);
  splitter.push(bytes);
  const seconds = clusters.map((c) => (c.timestamp * splitter.timestampScaleNs) / 1e9);
  return { header, clusters, seconds, bytes: bytes.length };
}

test('go live to the stand-in for YouTube: H.264 and AAC, a keyframe every 2 s; then end', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-live-'));
  const got = join(dir, 'received.flv');
  listeners.push(rtmpListener(ffmpeg ?? '', port, got));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(app, win, port, dir);

  // Going live asks first; Cancel changes nothing.
  const panel = win.getByTestId('stream-panel');
  await panel.getByTestId('go-live').click();
  const confirm = win.getByTestId('go-live-confirm');
  await expect(confirm).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the go-live question');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(live(await bridge(win).status())).toBe('off');
  await panel.getByTestId('go-live').click();
  await confirm.getByRole('button', { name: 'Go live' }).click();

  await waitLive(win, userData, 'live', 30_000);
  await expect(win.getByTestId('on-air')).toHaveText('On air');
  // The window's own title says so too.
  const title = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))
        ?.getTitle(),
    );
  await expect.poll(title).toBe('Drashti — ON AIR');
  await expect(panel.getByTestId('stream-health')).toContainText('Good');
  await expect(panel.getByTestId('stream-bitrate')).not.toHaveText('—', { timeout: 10_000 });
  await expect(panel.getByText(/Encoder: /u)).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the Stream panel on air');
  await expectFits(panel, 'the Stream panel on air at 1280 x 720');
  // Several keyframes' worth.
  await win.waitForTimeout(7000);

  await panel.getByTestId('end-stream').click();
  const end = win.getByTestId('end-confirm');
  await end.getByRole('button', { name: 'End the stream' }).click();
  await expect.poll(async () => live(await bridge(win).status())).toBe('off');
  await expect(win.getByTestId('on-air')).toHaveCount(0);
  await expect.poll(title).toBe('Drashti');
  await app.close();

  // What the stand-in received.
  await expect.poll(() => existsSync(got) && statSync(got).size > 0).toBe(true);
  const flv = readFlv(got);
  expect(flv.videoFrames).toBeGreaterThan(100);
  expect(flv.audioFrames).toBeGreaterThan(100);
  expect(flv.aacSampleRate).toBe(48_000);
  expect(flv.aacChannels).toBe(2);
  expect(flv.keyframeTimes.length).toBeGreaterThanOrEqual(3);
  const gaps = flv.keyframeTimes.slice(1).map((t, i) => t - (flv.keyframeTimes[i] ?? 0));
  for (const gap of gaps)
    expect(Math.abs(gap - 2000), `keyframes ${gaps.join(', ')} ms apart`).toBeLessThanOrEqual(100);
});

test('cut the connection mid-stream: it reconnects by itself, and the recording carries on unbroken', async () => {
  test.setTimeout(120_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-reconnect-'));
  const first = rtmpListener(ffmpeg ?? '', port, join(dir, 'first.flv'));
  listeners.push(first);
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir);
  const started = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const rec = await d.stream.startRecording();
    const on = await d.stream.goLive({ confirmed: true });
    return [rec.ok, on.ok];
  });
  expect(started).toEqual([true, true]);
  await waitLive(win, userData, 'live', 30_000);
  await expect(win.getByTestId('rec')).toBeVisible();
  const recordingSince = Date.now();
  await win.waitForTimeout(3000);

  // The far end goes away, as when the internet drops.
  first.kill('SIGKILL');
  await waitLive(win, userData, 'reconnecting', 30_000);
  await expect(win.getByTestId('stream-live-message')).toContainText('Trying again');
  await expect(win.getByTestId('on-air')).toContainText('reconnecting');
  // Recording goes on meanwhile.
  expect((await bridge(win).status()).recording.state).toBe('recording');
  await win.waitForTimeout(2000);

  // It comes back: Drashti connects again by itself.
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'second.flv')));
  await waitLive(win, userData, 'live', 45_000);
  const after = await bridge(win).status();
  expect(after.live.reconnects).toBeGreaterThanOrEqual(1);
  await win.waitForTimeout(3000);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.stream.end({ confirmed: true });
    await d.stream.stopRecording();
  });
  const recordedFor = (Date.now() - recordingSince) / 1000;
  await expect.poll(async () => (await bridge(win).status()).recording.state).toBe('off');
  await app.close();

  // One recording, from start to end, with no gap where the connection dropped.
  const files = readdirSync(dir).filter((f) => f.endsWith('.mkv'));
  expect(files).toHaveLength(1);
  const { header, clusters, seconds: times } = readRecording(join(dir, files[0] ?? ''));
  expect(header).toBe(true);
  expect(clusters[0]?.startsPicture).toBe(true);
  // Clusters are up to a keyframe apart (2 s): a dropped connection would leave a longer gap.
  const longestGap = Math.max(...times.slice(1).map((t, i) => t - (times[i] ?? 0)));
  expect(longestGap).toBeLessThan(2.5);
  expect(times.at(-1) ?? 0).toBeGreaterThan(recordedFor - 3);
  expect(existsSync(join(dir, 'second.flv'))).toBe(true);
});

test('after a run, the made-up key is nowhere: not in the logs, diagnostics, database, backups or the windows', async () => {
  test.setTimeout(120_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-key-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv')));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir);
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true });
  });
  await waitLive(win, userData, 'live', 30_000);
  // A connection dropped and made again puts the address (with the key) through FFmpeg's messages.
  listeners.splice(0).forEach((l) => l.kill('SIGKILL'));
  await waitLive(win, userData, 'reconnecting', 30_000);
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'again.flv')));
  await waitLive(win, userData, 'live', 45_000);

  // The windows: the operator's page, its storage, every answer it gets about the stream, and the stream's page.
  const program = await streamPage(app);
  const seen = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return [
      document.documentElement.outerHTML,
      JSON.stringify(Object.entries(localStorage)),
      JSON.stringify(await d.stream.status()),
      JSON.stringify(await d.stream.profiles()),
    ].join('\n');
  });
  expect(seen).not.toContain(TEST_KEY);
  expect(await program.evaluate(() => document.documentElement.outerHTML)).not.toContain(TEST_KEY);
  await win.getByTestId('open-stream-settings').click();
  await expect(win.getByTestId('stream-key-saved')).toBeVisible();
  expect(await win.evaluate(() => document.documentElement.outerHTML)).not.toContain(TEST_KEY);
  await win.getByRole('button', { name: 'Close stream settings' }).click();

  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.end({ confirmed: true });
  });
  await expect.poll(async () => live(await bridge(win).status())).toBe('off');

  // Diagnostics and a backup.
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-key-desktop-'));
  const backups = mkdtempSync(join(tmpdir(), 'drashti-key-backups-'));
  await app.evaluate(
    ({ app: electronApp, dialog }, { desk, into }) => {
      electronApp.setPath('desktop', desk);
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
      dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: true });
    },
    { desk: desktop, into: backups },
  );
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop' })).toBeVisible();
  await chooseMenuItem(app, 'backup-library');
  await expect(win.getByRole('alert').filter({ hasText: 'Library backed up to' })).toBeVisible();
  await app.close();

  // Every file Drashti wrote: its data folder (library, logs, settings), the diagnostics and the backup.
  const files = (root: string) =>
    (readdirSync(root, { recursive: true }) as string[])
      .map((f) => join(root, f))
      .filter((f) => statSync(f).isFile());
  const all = [...files(userData), ...files(desktop), ...files(backups)];
  expect(all.some((f) => f.endsWith('.log'))).toBe(true);
  expect(all.some((f) => f.endsWith('drashti.sqlite'))).toBe(true);
  const keyFile = all.find((f) => f.endsWith('stream-keys.json'));
  expect(keyFile).toBeDefined();
  for (const f of all) expect(readFileSync(f).includes(Buffer.from(TEST_KEY)), f).toBe(false);
  // The library's database holds no key column, and the backup never takes the key file.
  expect(files(backups).some((f) => f.endsWith('stream-keys.json'))).toBe(false);
});

test('without the system’s secure storage, no key is kept, and the settings say why', async () => {
  const { app, userData } = await launchApp({ ...FAKE, DRASHTI_TEST_NO_SAFE_STORAGE: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByTestId('open-stream').click();
  await win.getByTestId('open-stream-settings').click();
  await expect(win.getByTestId('stream-key-unavailable')).toContainText('plain text');
  await expect(win.getByTestId('stream-key-input')).toHaveCount(0);
  const tried = await win.evaluate(async (key) => {
    const d = (globalThis as PageGlobals).drashti;
    const { activeId } = await d.stream.profiles();
    const kept = await d.stream.setKey(activeId ?? '', key);
    const live = await d.stream.goLive({ confirmed: true });
    return { kept: kept.ok ? 'kept' : kept.message, live: live.ok ? 'live' : live.message };
  }, TEST_KEY);
  expect(tried.kept).toContain('plain text');
  expect(tried.live).toContain('plain text');
  expect(existsSync(join(userData, 'stream-keys.json'))).toBe(false);
  await expectNoSeriousA11yIssues(win, 'the stream settings without secure storage');
  await app.close();
});

test('Simple Mode shows ON AIR and REC, and refuses starting, ending or changing the stream', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-stream-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv')));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.stream.startRecording();
    await d.stream.goLive({ confirmed: true });
  });
  await waitLive(win, userData, 'live', 30_000);
  await win.getByRole('button', { name: 'Close stream' }).click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('on-air')).toBeVisible();
  await expect(win.getByTestId('rec')).toBeVisible();
  const answers = await win.evaluate(async (key) => {
    const s = (globalThis as PageGlobals).drashti.stream;
    const { profiles, activeId } = await s.profiles();
    const p = profiles.find((x) => x.id === activeId);
    const input = p
      ? {
          name: p.name,
          url: p.url,
          preset: p.preset,
          camera: p.camera,
          sound: p.sound,
          soundDelayMs: 0,
          mixOwnSound: false,
        }
      : null;
    const all = await Promise.all([
      s.end({ confirmed: true }),
      s.goLive({ confirmed: true }),
      s.stopRecording(),
      s.startRecording(),
      s.setLayout('slides'),
      s.saveProfile(activeId, input ?? ({} as never)),
      s.saveProfile(null, input ?? ({} as never)),
      s.removeProfile(activeId ?? ''),
      s.useProfile(activeId ?? ''),
      s.setKey(activeId ?? '', key),
      s.removeKey(activeId ?? ''),
      s.pickFolder(),
    ]);
    return all.map((r) => (r.ok ? 'done' : r.message));
  }, TEST_KEY);
  for (const a of answers) expect(a).toBe(SIMPLE_MODE_REFUSAL);
  // Still on air and recording: nothing changed.
  const after = await bridge(win).status();
  expect([after.live.state, after.recording.state, after.layout]).toEqual(['live', 'recording', 'camera']);
  await expectNoSeriousA11yIssues(win, 'Simple Mode on air and recording');
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.stream.end({ confirmed: true });
    await d.stream.stopRecording();
  });
  await app.close();
});

test('a port lost on its way to the stream’s page is given again, so the stream still goes live', async () => {
  test.setTimeout(90_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-lost-port-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'lost.flv')));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir);
  // The first port for the encoder never reaches the page (as if it arrived before the page listened).
  await app.evaluate(({ webContents }) => {
    const any = webContents.getAllWebContents()[0];
    if (!any) throw new Error('no web contents');
    const proto = Object.getPrototypeOf(any) as {
      postMessage: (this: unknown, channel: string, message: unknown, transfer?: unknown[]) => void;
    };
    const real = proto.postMessage;
    let dropped = false;
    proto.postMessage = function (this: unknown, channel: string, message: unknown, transfer?: unknown[]) {
      if (
        !dropped &&
        channel === 'stream:port' &&
        (message as { role?: string } | null)?.role === 'encoder'
      ) {
        dropped = true;
        return;
      }
      real.call(this, channel, message, transfer);
    };
  });
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true });
  });
  await waitLive(win, userData, 'live', 45_000);
  expect(streamLog(userData)).toContain('no picture from its page for 5 s: connecting it again');
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.end({ confirmed: true });
  });
  await app.close();
});

test('on air, and on air again, with the preview watched and a picture standing still (no camera)', async () => {
  test.setTimeout(150_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-still-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'still.flv')));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir, false);
  // The preview is watched, so the stream page's capture is already going. With no camera, nothing on
  // the Program moves, and a capture gives a frame only when the picture changes (Session 18: on CI's
  // Mac a still picture over the camera kept the stream "starting" after the pause between sabhas).
  const page = await streamPage(app);
  const frames = () => page.evaluate(() => Number(document.body.dataset['frames'] ?? '0'));
  await expect.poll(frames).toBeGreaterThan(0);
  // The picture stands still: the capture gives no new frame for 2.5 s (once it has settled: a capture
  // that starts may give a second frame as the page finishes drawing).
  const standsStill = () =>
    expect
      .poll(
        async () => {
          const before = await frames();
          await win.waitForTimeout(2500);
          return (await frames()) === before;
        },
        { message: 'the capture gives no new frame: the picture stands still', timeout: 30_000 },
      )
      .toBe(true);
  const goLive = () =>
    win.evaluate(async () => {
      await (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true });
    });
  await standsStill();
  await goLive();
  await waitLive(win, userData, 'live', 30_000);
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.end({ confirmed: true });
  });
  await waitLive(win, userData, 'off');
  // The stand-in for YouTube takes one stream: a new one listens for the next.
  listeners.splice(0).forEach((l) => l.kill('SIGKILL'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'still-again.flv')));
  // On air again: the picture still stands still, and the stream has it at once.
  await standsStill();
  await goLive();
  await waitLive(win, userData, 'live', 30_000);
  expect(streamLog(userData)).not.toContain('no picture from its page');
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.end({ confirmed: true });
  });
  await app.close();
});

test('after a crash on air: back on air by itself within 5 minutes, in a new recording file; later, only offered', async () => {
  test.setTimeout(150_000);
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-crash-stream-'));
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'before.flv')));
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUp(app, win, port, dir);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.stream.startRecording();
    await d.stream.goLive({ confirmed: true });
  });
  await waitLive(win, userData, 'live', 30_000);
  await win.waitForTimeout(3000);
  // On Windows, safeStorage's own key lives in Chromium's Local State file, written a few seconds after
  // it is made: a crash before that leaves the stream key unreadable (a real crash that soon after
  // saving a key would too; the operator is then asked to paste it again).
  if (process.platform === 'win32')
    await expect
      .poll(
        () =>
          existsSync(join(userData, 'Local State')) &&
          readFileSync(join(userData, 'Local State'), 'utf8').includes('encrypted_key'),
        {
          timeout: 60_000,
        },
      )
      .toBe(true);
  await killApp(app);

  // Started again soon after: on air and recording again by itself, and says so.
  listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'after.flv')));
  const again = await relaunchApp(userData, FAKE);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await waitLive(win2, userData, 'live', 45_000);
  await expect(win2.getByRole('alert').filter({ hasText: 'went live again by itself' })).toBeVisible({
    timeout: 20_000,
  });
  expect((await bridge(win2).status()).recording.state).toBe('recording');
  await win2.waitForTimeout(3000);
  await win2.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.stream.end({ confirmed: true });
    await d.stream.stopRecording();
  });
  await expect.poll(async () => (await bridge(win2).status()).recording.state).toBe('off');
  // Two recordings: the one cut short by the crash still reads from the start (it plays), and a new one.
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.mkv'))
    .sort();
  if (files.length !== 2)
    console.log(`Recordings: ${files.join(', ')}. The stream's log:\n${streamLog(userData)}`);
  expect(files).toHaveLength(2);
  for (const f of files) {
    const { header, clusters, seconds } = readRecording(join(dir, f));
    expect(header, f).toBe(true);
    expect(clusters[0]?.startsPicture, f).toBe(true);
    expect(seconds.at(-1) ?? 0, f).toBeGreaterThan(2);
  }

  // Stopped again, and started 6 minutes later: only offered.
  await win2.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true });
  });
  await expect.poll(async () => live(await bridge(win2).status()), { timeout: 30_000 }).not.toBe('off');
  await killApp(again.app);
  const stateFile = join(userData, 'stream-state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { at: number };
  writeFileSync(stateFile, JSON.stringify({ ...state, at: Date.now() - 6 * 60 * 1000 }));
  const later = await relaunchApp(userData, FAKE);
  const win3 = await operatorPage(later.app);
  await operatorReady(win3);
  await expect(win3.getByRole('alert').filter({ hasText: 'more than 5 minutes ago' })).toBeVisible({
    timeout: 20_000,
  });
  const offered = await bridge(win3).status();
  expect(offered.live.state).toBe('off');
  expect(offered.resume).toMatchObject({ live: true, profileName: 'Local test' });
  await win3.getByTestId('open-stream').click();
  await expect(win3.getByRole('button', { name: 'Go live again' })).toBeVisible();
  await later.app.close();
});
