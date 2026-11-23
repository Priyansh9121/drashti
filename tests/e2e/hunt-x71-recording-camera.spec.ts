import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MkvSplitter, type MkvCluster } from '../../src/main/stream/worker/mkv';
import { notices } from './hall-looks';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, readFlv, rtmpListener, setUpStream, streamPage, testFfmpeg } from './stream-helpers';

// Generated fake camera/microphone; local receiver only. Small parts exercise the same rollover as a long show.
test('H6 G-E2: a recording folder renamed away preserves earlier parts and tells the operator when the next cannot be written', async () => {
  test.setTimeout(90_000);
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled FFmpeg is required');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-folder-'));
  const folder = join(dir, 'recordings');
  const removed = join(dir, 'removed-recordings');
  mkdirSync(folder);
  const port = await freePort();
  const received = join(dir, 'received.flv');
  const listener = rtmpListener(ffmpeg, port, received);
  const { app } = await launchApp({
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_RECORD_PART_BYTES: '100000',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, port, folder);
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    expect(
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true }))).ok,
    ).toBe(true);
    await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');
    await expect
      .poll(() => readdirSync(folder).filter((f) => f.endsWith('.mkv')).length)
      .toBeGreaterThanOrEqual(2);
    const firstFile = readdirSync(folder).find((f) => f.endsWith('.mkv') && !f.includes(' part '));
    if (!firstFile) throw new Error('The first recording part is missing');
    const earlier = readFileSync(join(folder, firstFile));
    renameSync(folder, removed);
    await expect.poll(async () => (await status()).recording.state).toBe('off');
    expect((await status()).recording.message).toContain('could not be written');
    await expect.poll(async () => (await notices(win)).join(' ')).toContain('could not be written');
    expect((await status()).live.state).toBe('live');
    const before = readFlv(received).videoFrames;
    await expect.poll(() => readFlv(received).videoFrames).toBeGreaterThan(before + 30);
    expect(readFileSync(join(removed, firstFile))).toEqual(earlier);
    const clusters: MkvCluster[] = [];
    const splitter = new MkvSplitter(
      () => undefined,
      (c) => clusters.push(c),
    );
    splitter.push(earlier);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]?.startsPicture).toBe(true);
    console.log(
      `HUNT-x71 G-E2 folder-away earlierBytes=${String(earlier.length)} earlierClusters=${String(clusters.length)} live=${(await status()).live.state} recording=${(await status()).recording.state}`,
    );
  } finally {
    await app.close();
    if (listener.exitCode === null && listener.signalCode === null) {
      const gone = once(listener, 'exit');
      listener.kill('SIGKILL');
      await gone;
    }
  }
});

test('H6 G-E3: a camera track ending on air reports missing without interrupting the stream or recording', async () => {
  test.setTimeout(90_000);
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled FFmpeg is required');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-camera-'));
  const port = await freePort();
  const received = join(dir, 'received.flv');
  const listener = rtmpListener(ffmpeg, port, received);
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, port, dir);
    const program = await streamPage(app);
    await win.getByTestId('stream-layout-camera').click();
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-camera', 'on');
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    expect(
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true }))).ok,
    ).toBe(true);
    await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');
    await expect.poll(async () => (await status()).recording.bytes).toBeGreaterThan(10_000);
    // Reaction probe: the browser raises 'ended' when an input is unplugged. stop() alone never raises it.
    const ended = await program.getByTestId('program-camera').evaluate((element) => {
      const video = element instanceof HTMLVideoElement ? element : element.querySelector('video');
      const stream = video?.srcObject;
      if (!(stream instanceof MediaStream)) return 0;
      const tracks = stream.getVideoTracks();
      for (const track of tracks) {
        track.stop();
        track.dispatchEvent(new Event('ended'));
      }
      return tracks.length;
    });
    expect(ended).toBe(1);
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-camera', 'missing');
    await expect.poll(async () => (await status()).inputs.camera).toBe('missing');
    await expect(win.getByTestId('stream-camera-state')).toHaveText('Not connected');
    const bytes = (await status()).recording.bytes;
    const receivedBefore = existsSync(received) ? readFlv(received).videoFrames : 0;
    await expect.poll(() => readFlv(received).videoFrames).toBeGreaterThan(receivedBefore + 30);
    expect((await status()).live.state).toBe('live');
    expect((await status()).recording.state).toBe('recording');
    expect((await status()).recording.bytes).toBeGreaterThan(bytes);
    console.log(
      `HUNT-x71 G-E3 ended=${String(ended)} camera=${(await status()).inputs.camera} live=${(await status()).live.state} recordingBytes=${String((await status()).recording.bytes)}`,
    );
  } finally {
    await app.close();
    if (listener.exitCode === null && listener.signalCode === null) {
      const gone = once(listener, 'exit');
      listener.kill('SIGKILL');
      await gone;
    }
  }
});

test.afterEach(() => {
  const info = test.info();
  console.log(`HUNT-x71 case=${info.title} status=${String(info.status)}`);
});
