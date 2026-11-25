import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page, Worker as BrowserWorker } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../../src/shared/ipc';
import { longestPcmWait, type PcmDelivery } from '../../src/main/testing/pcm-gaps';
import { letTimePass } from './helpers';
import { setupVideoCue } from './video-cue-helpers';

// This generated stand-in receives the real capture port in its own utility process, like the encoder.
const OBSERVER = `
      const ports = []; let port, frames = 0, started = 0, previous = 0, longest = 0, ready = false;
      // Diagnostics only (a22-cue, the Mac's one 38.9 ms gap in a21-s5-1123-152334-44457): each gap over 20 ms, on the
      // wall clock, to set beside the drawing page's long frame.
      let gaps = [], previousWall = 0;
      // Every delivery from the start of the watch to its end, on both clocks: the waits that overlap the long frame are
      // what the test judges (src/main/testing/pcm-gaps.ts).
      let deliveries = [];
      const send = (message) => process.parentPort.postMessage(message);
      process.parentPort.on('message', (event) => {
        if (event.data === 'begin') {
          frames = 0; longest = 0; gaps = []; started = previous = performance.now(); previousWall = Date.now();
          deliveries = [{ wall: previousWall, mono: started }];
          send({ kind: 'begun' });
        } else if (event.data === 'finish') {
          const now = performance.now();
          if (started > 0) deliveries.push({ wall: Date.now(), mono: now });
          send({ kind: 'result', frames, elapsed: now - started,
            longestGap: Math.max(longest, now - previous), gaps, deliveries, begunAt: Date.now() - (now - started) });
        } else if (event.ports[0]) {
          port = event.ports[0]; ports.push(port);
          port.on('message', ({ data }) => {
            if (data.kind !== 'audio') return;
            const now = performance.now();
            frames += data.frames;
            longest = Math.max(longest, now - previous);
            if (started > 0 && now - previous > 20) gaps.push({ at: Date.now(), after: previousWall, ms: now - previous, frames: data.frames });
            if (started > 0) deliveries.push({ wall: Date.now(), mono: now });
            previous = now;
            previousWall = Date.now();
            if (!ready) { ready = true; send({ kind: 'ready' }); }
          });
          port.start();
        }
      });
    `;

interface ObserverProbe {
  waitFor: (kind: string) => Promise<Record<string, number>>;
  send: (text: string) => void;
  stop: () => void;
}

/** The stand-in encoder, paired with the stream's page as the stream service pairs the real one. */
async function startObserver(app: ElectronApplication, dir: string, url: string): Promise<void> {
  const file = join(dir, 'pcm-observer.cjs');
  writeFileSync(file, OBSERVER);
  await app.evaluate(
    async ({ BrowserWindow, MessageChannelMain, utilityProcess }, { file, url, ipc }) => {
      const child = utilityProcess.fork(file, [], {
        serviceName: 'Generated PCM observer',
        stdio: 'ignore',
      });
      const waitFor = (kind: string): Promise<Record<string, number>> =>
        new Promise((resolve) => {
          const receive = (value: unknown) => {
            const message = value as { kind?: string };
            if (message.kind !== kind) return;
            child.removeListener('message', receive);
            resolve(message as Record<string, number>);
          };
          child.on('message', receive);
        });
      const ready = waitFor('ready');
      const page = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      if (!page) throw new Error('No generated stream page');
      const sound = new MessageChannelMain();
      child.postMessage('port', [sound.port1]);
      page.webContents.postMessage(ipc, { role: 'encoder-audio' }, [sound.port2]);
      const { port1, port2 } = new MessageChannelMain();
      child.postMessage('port', [port1]);
      (globalThis as { s5PcmQueue?: ObserverProbe }).s5PcmQueue = {
        waitFor,
        send: (text) => child.postMessage(text),
        stop: () => {
          child.kill();
        },
      };
      page.webContents.postMessage(ipc, { role: 'encoder' }, [port2]);
      await ready;
    },
    { file, url, ipc: IPC.stream.port },
  );
}

/** The watch starts: the stand-in counts every sample it is sent from now on. */
async function beginWatch(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const probe = (globalThis as { s5PcmQueue?: ObserverProbe }).s5PcmQueue;
    if (!probe) throw new Error('No generated PCM observer');
    const begun = probe.waitFor('begun');
    probe.send('begin');
    await begun;
  });
}

/** The watch ends: what the stand-in was sent, and when. */
async function finishWatch(app: ElectronApplication): Promise<Record<string, number>> {
  return await app.evaluate(async () => {
    const probe = (globalThis as { s5PcmQueue?: ObserverProbe }).s5PcmQueue;
    if (!probe) throw new Error('No generated PCM observer');
    const result = probe.waitFor('result');
    probe.send('finish');
    return await result;
  });
}

async function stopObserver(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as { s5PcmQueue?: ObserverProbe };
    g.s5PcmQueue?.stop();
    delete g.s5PcmQueue;
  });
}

/**
 * Diagnostics only (QA23-PCMLONG-1, alpha.22 gate 5's Mac :126, 227 ms of sound missing at the watch's end): each sound
 * chunk the stream page's PCM worker reads, as [read time, Chromium's own capture time in microseconds]. A hole in the
 * capture times means no sound was made; capture times on time but read late mean the worker was held. Never judged.
 */
async function probeReads(page: Page): Promise<BrowserWorker | null> {
  const worker = page
    .workers()
    .filter((w) => w.url().includes('encoder-audio-worker'))
    .at(-1);
  if (!worker) return null;
  const on = await worker
    .evaluate(() => {
      const close = Object.getOwnPropertyDescriptor(AudioData.prototype, 'close');
      if (!close) return false;
      const rows: [number, number][] = [];
      Object.defineProperty(AudioData.prototype, 'close', {
        ...close,
        value(this: AudioData) {
          if (rows.length < 20_000) rows.push([Date.now(), this.timestamp]);
          (close.value as (this: AudioData) => void).call(this);
        },
      });
      (globalThis as { pcmReads?: () => unknown }).pcmReads = () => {
        Object.defineProperty(AudioData.prototype, 'close', close);
        return rows;
      };
      return true;
    })
    .catch(() => false);
  return on ? worker : null;
}

/** The long frame's numbers from the probe and the stand-in, printed to the job log on every run, green or not. */
function readsAround(reads: [number, number][], deliveries: PcmDelivery[], from: number, to: number) {
  const base = Math.min(...reads.map(([at, ts]) => at - ts / 1000));
  const near = reads.filter(([at]) => at >= from - 100 && at <= to + 50);
  const gaps = (v: number[]) => Math.max(0, ...v.slice(1).map((x, i) => x - (v[i] ?? x)));
  let wait: number | null;
  try {
    wait = longestPcmWait(deliveries, from, to);
  } catch {
    wait = null;
  }
  return {
    reads: near.length,
    longestReadGapMs: gaps(near.map(([at]) => at)),
    largestCaptureHoleMs: gaps(near.map(([, ts]) => ts / 1000).sort((a, b) => a - b)),
    longestQueueWaitMs: Math.max(0, ...near.map(([at, ts]) => at - ts / 1000 - base)),
    longestDeliveryWaitMs: wait,
    // The stand-in's wait from its last sound to the watch's end (its last entry is the end, not a delivery).
    endWaitMs: (deliveries.at(-1)?.wall ?? 0) - Math.max(...deliveries.slice(1, -1).map((d) => d.wall)),
  };
}

test('The stream forwards continuous PCM while its drawing page handles a half-second long frame', async () => {
  const { app, stream, dir } = await setupVideoCue(true);
  try {
    await startObserver(app, dir, stream.url());
    const reader = await probeReads(stream);
    await beginWatch(app);
    const longFrame = await stream.evaluate(() => {
      const from = Date.now();
      const at = performance.now();
      // Deliberately occupy this renderer, as the retained S5 long frames do. This is the cause under test.
      while (performance.now() - at < 500) Math.sqrt(performance.now());
      return { from, to: Date.now() };
    });
    const result = await finishWatch(app);
    const reads = ((await reader
      ?.evaluate(() => (globalThis as { pcmReads?: () => unknown }).pcmReads?.())
      .catch(() => null)) ?? []) as [number, number][];
    await test.info().attach('s5-pcm-queue.json', {
      body: Buffer.from(JSON.stringify({ ...result, longFrame, reads })),
      contentType: 'application/json',
    });
    const summary = { frames: result['frames'], elapsed: result['elapsed'], longFrame };
    const watched = (result as unknown as { deliveries?: PcmDelivery[] }).deliveries ?? [];
    console.log(
      'PCM_LONG ' +
        JSON.stringify(
          reads.length > 0 && watched.length > 1
            ? { ...summary, ...readsAround(reads, watched, longFrame.from, longFrame.to) }
            : { ...summary, reads: reads.length },
        ),
    );
    const elapsed = result['elapsed'] ?? 0;
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(
      (result['frames'] ?? 0) / 48,
      '48 kHz PCM keeps its full duration through the long drawing frame',
    ).toBeGreaterThanOrEqual(elapsed - 1000 / 30);
    // The waits that overlap the long frame (alpha.22 gate 3: a wait before it, on CI's Mac's software-timed sound, is
    // not the frame's; the whole watch's longest stays in the record above).
    const deliveries = (result as unknown as { deliveries: PcmDelivery[] }).deliveries;
    // Judged only over a whole long frame its deliveries cover (fail closed; this also bounds the two processes'
    // clocks' offset by the watch's own round trips).
    expect(longFrame.to - longFrame.from).toBeGreaterThanOrEqual(500);
    expect(deliveries[0]?.wall ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(longFrame.from);
    expect(deliveries.at(-1)?.wall ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(longFrame.to);
    expect(
      longestPcmWait(deliveries, longFrame.from, longFrame.to),
      'the encoder receives sound through the long drawing frame',
    ).toBeLessThanOrEqual(1000 / 30);
  } finally {
    await stopObserver(app);
    await app.close();
  }
});

// a22-fadeskip / a22-soundkeep (run 45513574785's retry): on CI's two-core Windows the stream's PCM worker did not run
// for 335 ms, and Chromium's capture queue in front of it (MediaStreamTrackProcessor, 10 chunks of 10 ms by default)
// kept only the newest 100 ms: about 230 ms of the stream's sound never reached the encoder, heard as a skip.
test('The stream keeps all its sound while its PCM worker is held up for a quarter of a second', async () => {
  const { app, stream, dir } = await setupVideoCue(true);
  try {
    await startObserver(app, dir, stream.url());
    // The worker that reads the stream page's sound capture and sends it on (program/encoder-audio-worker.ts).
    let reader: BrowserWorker | undefined;
    await expect
      .poll(
        () => {
          reader = stream
            .workers()
            .filter((w) => w.url().includes('encoder-audio-worker'))
            .at(-1);
          return reader !== undefined;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    if (!reader) throw new Error('No PCM worker on the stream page');
    await beginWatch(app);
    const held = await reader.evaluate(() => {
      const from = Date.now();
      const at = performance.now();
      // Deliberately occupy the PCM worker's own thread, as a starved PC did. This is the cause under test.
      while (performance.now() - at < 250) Math.sqrt(performance.now());
      return { from, to: Date.now() };
    });
    await letTimePass(
      stream,
      500,
      'what the capture held while its worker was busy reaches the stand-in, then a steady stretch after it',
    );
    const result = await finishWatch(app);
    await test.info().attach('pcm-worker-held.json', {
      body: Buffer.from(JSON.stringify({ ...result, held })),
      contentType: 'application/json',
    });
    const elapsed = result['elapsed'] ?? 0;
    const deliveries = (result as unknown as { deliveries: PcmDelivery[] }).deliveries;
    // Judged only over a watch that covers the whole hold (fail closed).
    expect(held.to - held.from).toBeGreaterThanOrEqual(250);
    expect(deliveries[0]?.wall ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(held.from);
    expect(deliveries.at(-1)?.wall ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(held.to + 400);
    expect(elapsed).toBeGreaterThanOrEqual(750);
    // The hold really held the worker that forwards the sound: its deliveries stopped for most of it (fail closed).
    expect(
      longestPcmWait(deliveries, held.from, held.to),
      'the held worker is the one sending the stream’s sound',
    ).toBeGreaterThanOrEqual(200);
    expect(
      (result['frames'] ?? 0) / 48,
      '48 kHz PCM keeps its full duration while the stream’s PCM worker is held up',
    ).toBeGreaterThanOrEqual(elapsed - 1000 / 30);
  } finally {
    await stopObserver(app);
    await app.close();
  }
});
