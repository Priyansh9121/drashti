import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MkvSplitter, type MkvCluster } from '../../src/main/stream/worker/mkv';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { freePort, readFlv, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';

// The two-minute outage is observed continuously; no sleep or real network destination.
test('H6 G-E2: a local listener gone for two minutes reports reconnecting while one recording continues', async () => {
  test.setTimeout(180_000);
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled FFmpeg is required');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-outage-'));
  const listeners: ChildProcess[] = [];
  const first = rtmpListener(ffmpeg, port, join(dir, 'first.flv'));
  listeners.push(first);
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, port, dir);
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    const beganAt = Date.now();
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    expect(
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true }))).ok,
    ).toBe(true);
    await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');
    await expect.poll(async () => (await status()).recording.bytes).toBeGreaterThan(10_000);
    first.kill('SIGKILL');
    const goneAt = Date.now();
    await expect.poll(async () => (await status()).live.state).toBe('reconnecting');
    await expect(win.getByTestId('on-air')).toContainText('reconnecting');
    let bytes = (await status()).recording.bytes;
    const before = bytes;
    await expect
      .poll(
        async () => {
          const s = await status();
          expect(s.live.state, 'never claims on air while the listener is absent').toBe('reconnecting');
          expect(s.recording.state, 'recording stays on throughout the outage').toBe('recording');
          expect(s.recording.bytes, 'recording never resets during reconnect').toBeGreaterThanOrEqual(bytes);
          bytes = s.recording.bytes;
          return Date.now() - goneAt;
        },
        { timeout: 150_000 },
      )
      .toBeGreaterThanOrEqual(120_000);
    expect(bytes).toBeGreaterThan(before);
    const secondFile = join(dir, 'second.flv');
    listeners.push(rtmpListener(ffmpeg, port, secondFile));
    await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');
    await expect
      .poll(() => (existsSync(secondFile) ? readFlv(secondFile).videoFrames : 0))
      .toBeGreaterThan(30);
    expect((await status()).recording.state).toBe('recording');
    expect(
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.end({ confirmed: true }))).ok,
    ).toBe(true);
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
    const recordedSeconds = (Date.now() - beganAt) / 1000;
    await app.close();
    const files = readdirSync(dir).filter((f) => f.endsWith('.mkv'));
    expect(files).toHaveLength(1);
    const clusters: MkvCluster[] = [];
    let header = false;
    const splitter = new MkvSplitter(
      () => {
        header = true;
      },
      (c) => clusters.push(c),
    );
    splitter.push(readFileSync(join(dir, files[0] ?? '')));
    const seconds = clusters.map((c) => (c.timestamp * splitter.timestampScaleNs) / 1e9);
    const gap = Math.max(...seconds.slice(1).map((s, i) => s - (seconds[i] ?? 0)));
    console.log(
      `HUNT-x71 G-E2 outageMs=${String(Date.now() - goneAt)} clusters=${String(clusters.length)} longestGap=${String(gap)} recorded=${String(seconds.at(-1))} expected=${String(recordedSeconds)}`,
    );
    expect(header).toBe(true);
    expect(clusters[0]?.startsPicture).toBe(true);
    expect(gap).toBeLessThan(2.5);
    expect(seconds.at(-1) ?? 0).toBeGreaterThan(recordedSeconds - 3);
  } finally {
    for (const listener of listeners) listener.kill('SIGKILL');
    if (app.process().exitCode === null) await app.close();
  }
});

test.afterEach(() => {
  const info = test.info();
  console.log(`HUNT-x71 case=${info.title} status=${String(info.status)}`);
});
