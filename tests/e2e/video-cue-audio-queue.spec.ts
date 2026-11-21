import { expect, test } from '@playwright/test';
import { setupVideoCue } from './video-cue-helpers';

test('The stream forwards continuous PCM while its drawing page handles a half-second long frame', async () => {
  const { app, stream } = await setupVideoCue(true);
  try {
    const result = await stream.evaluate(async () => {
      // A stand-in for the encoder's own process: it keeps receiving while the drawing page is busy.
      const source = `
        let port, frames = 0, started = 0, previous = 0, longest = 0, ready = false;
        onmessage = (event) => {
          if (event.data === 'begin') {
            frames = 0; longest = 0; started = previous = performance.now();
            postMessage({ kind: 'begun' });
          } else if (event.data === 'finish') {
            const now = performance.now();
            postMessage({ kind: 'result', frames, elapsed: now - started,
              longestGap: Math.max(longest, now - previous) });
          } else if (event.ports[0]) {
            port = event.ports[0];
            port.onmessage = ({ data }) => {
              if (data.kind !== 'audio') return;
              const now = performance.now();
              frames += data.frames;
              longest = Math.max(longest, now - previous);
              previous = now;
              if (!ready) { ready = true; postMessage({ kind: 'ready' }); }
            };
            port.start();
          }
        };
      `;
      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      const worker = new Worker(url);
      const channel = new MessageChannel();
      const waitFor = <T>(kind: string) =>
        new Promise<T>((resolve) => {
          const receive = (event: MessageEvent<{ kind: string }>) => {
            if (event.data.kind !== kind) return;
            worker.removeEventListener('message', receive);
            resolve(event.data as T);
          };
          worker.addEventListener('message', receive);
        });
      try {
        const ready = waitFor('ready');
        worker.postMessage('port', [channel.port2]);
        window.postMessage({ drashtiStreamPort: 'encoder' }, '*', [channel.port1]);
        await ready;
        const begun = waitFor('begun');
        worker.postMessage('begin');
        await begun;
        const at = performance.now();
        // Deliberately occupy this renderer, as the retained S5 drawing traces do. This is the cause under test.
        while (performance.now() - at < 500) Math.sqrt(performance.now());
        const result = waitFor<{ frames: number; elapsed: number; longestGap: number }>('result');
        worker.postMessage('finish');
        return await result;
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    });
    await test.info().attach('s5-pcm-queue.json', {
      body: Buffer.from(JSON.stringify(result)),
      contentType: 'application/json',
    });
    expect(result.elapsed).toBeGreaterThanOrEqual(500);
    expect(
      result.frames / 48,
      '48 kHz PCM keeps its full duration through the long drawing frame',
    ).toBeGreaterThanOrEqual(result.elapsed - 1000 / 30);
    expect(
      result.longestGap,
      'the encoder receives sound through the long drawing frame',
    ).toBeLessThanOrEqual(1000 / 30);
  } finally {
    await app.close();
  }
});
