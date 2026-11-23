import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../../src/shared/ipc';
import { streamSoundPage } from './stream-helpers';
import { setupVideoCue } from './video-cue-helpers';

test('The stream forwards continuous PCM while its drawing page handles a half-second long frame', async () => {
  const { app, stream, dir } = await setupVideoCue(true);
  try {
    const streamSound = await streamSoundPage(app);
    // This generated stand-in receives the real capture port in its own utility process, like the encoder.
    const file = join(dir, 'pcm-observer.cjs');
    writeFileSync(
      file,
      `
      const ports = []; let port, frames = 0, started = 0, previous = 0, longest = 0, ready = false;
      const send = (message) => process.parentPort.postMessage(message);
      process.parentPort.on('message', (event) => {
        if (event.data === 'begin') {
          frames = 0; longest = 0; started = previous = performance.now();
          send({ kind: 'begun' });
        } else if (event.data === 'finish') {
          const now = performance.now();
          send({ kind: 'result', frames, elapsed: now - started,
            longestGap: Math.max(longest, now - previous) });
        } else if (event.ports[0]) {
          port = event.ports[0]; ports.push(port);
          port.on('message', ({ data }) => {
            if (data.kind !== 'audio') return;
            const now = performance.now();
            frames += data.frames;
            longest = Math.max(longest, now - previous);
            previous = now;
            if (!ready) { ready = true; send({ kind: 'ready' }); }
          });
          port.start();
        }
      });
    `,
    );
    await app.evaluate(
      async ({ BrowserWindow, MessageChannelMain, utilityProcess }, { file, url, soundUrl, ipc }) => {
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
        const soundPage = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === soundUrl);
        if (!soundPage) throw new Error('No generated stream sound page');
        soundPage.webContents.postMessage(ipc, { role: 'encoder-audio' }, [sound.port2]);
        const { port1, port2 } = new MessageChannelMain();
        child.postMessage('port', [port1]);
        (
          globalThis as {
            s5PcmQueue?: { waitFor: typeof waitFor; send: (text: string) => void; stop: () => void };
          }
        ).s5PcmQueue = {
          waitFor,
          send: (text) => child.postMessage(text),
          stop: () => {
            child.kill();
          },
        };
        page.webContents.postMessage(ipc, { role: 'encoder' }, [port2]);
        await ready;
      },
      { file, url: stream.url(), soundUrl: streamSound.url(), ipc: IPC.stream.port },
    );
    await app.evaluate(async () => {
      const probe = (
        globalThis as {
          s5PcmQueue?: { waitFor: (kind: string) => Promise<unknown>; send: (text: string) => void };
        }
      ).s5PcmQueue;
      if (!probe) throw new Error('No generated PCM observer');
      const begun = probe.waitFor('begun');
      probe.send('begin');
      await begun;
    });
    await stream.evaluate(() => {
      const at = performance.now();
      // Deliberately occupy this renderer, as the retained S5 long frames do. This is the cause under test.
      while (performance.now() - at < 500) Math.sqrt(performance.now());
    });
    const result = await app.evaluate(async () => {
      const probe = (
        globalThis as {
          s5PcmQueue?: {
            waitFor: (kind: string) => Promise<Record<string, number>>;
            send: (text: string) => void;
          };
        }
      ).s5PcmQueue;
      if (!probe) throw new Error('No generated PCM observer');
      const result = probe.waitFor('result');
      probe.send('finish');
      return await result;
    });
    await test.info().attach('s5-pcm-queue.json', {
      body: Buffer.from(JSON.stringify(result)),
      contentType: 'application/json',
    });
    const elapsed = result['elapsed'] ?? 0;
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(
      (result['frames'] ?? 0) / 48,
      '48 kHz PCM keeps its full duration through the long drawing frame',
    ).toBeGreaterThanOrEqual(elapsed - 1000 / 30);
    expect(
      result['longestGap'],
      'the encoder receives sound through the long drawing frame',
    ).toBeLessThanOrEqual(1000 / 30);
  } finally {
    await app.evaluate(() => {
      const g = globalThis as { s5PcmQueue?: { stop: () => void } };
      g.s5PcmQueue?.stop();
      delete g.s5PcmQueue;
    });
    await app.close();
  }
});
