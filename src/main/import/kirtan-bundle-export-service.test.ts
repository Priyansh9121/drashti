import { describe, expect, it, vi } from 'vitest';
import { KirtanBundleExporter } from './kirtan-bundle-export-service';
import type { WorkerProcess } from './import-service';
import type { FromWorker, ToWorker } from './protocol';

function setup() {
  const sent: ToWorker[] = [];
  let message: (m: FromWorker) => void = () => undefined;
  let exit: (code: number) => void = () => undefined;
  const worker: WorkerProcess = {
    postMessage: (m) => {
      sent.push(m);
    },
    onMessage: (f) => {
      message = f;
    },
    onExit: (f) => {
      exit = f;
    },
    kill: vi.fn(),
  };
  const service = new KirtanBundleExporter({
    spawn: () => worker,
    dbFile: '/placeholder/library.sqlite',
    mediaDir: '/placeholder/Media',
    schemaVersion: 83,
  });
  const start = () =>
    service.export({
      presentationIds: ['placeholder-kirtan'],
      includeMedia: true,
      output: '/placeholder/Chosen.drashti-kirtans',
    });
  return {
    service,
    worker,
    sent,
    start,
    reply: (m: FromWorker) => message(m),
    exit: (code: number) => exit(code),
  };
}

describe('background kirtan bundle export', () => {
  it('passes only the chosen kirtans and media choice to the worker, and returns its finished result', async () => {
    const t = setup();
    const result = t.start();
    expect(t.sent[0]).toMatchObject({
      type: 'export-kirtans',
      presentationIds: ['placeholder-kirtan'],
      includeMedia: true,
      output: '/placeholder/Chosen.drashti-kirtans',
    });
    const request = t.sent[0];
    if (!request || request.type !== 'export-kirtans') throw new Error('Wrong worker request');
    t.reply({
      type: 'exported-kirtans',
      requestId: request.requestId,
      result: { ok: true, file: request.output, kirtans: 1, media: 1 },
    });
    expect(await result).toMatchObject({ ok: true, kirtans: 1, media: 1 });
    expect(t.worker.kill).toHaveBeenCalledOnce();
  });
  it('reports worker failure or exit and rejects a second export while one is running', async () => {
    const t = setup();
    const first = t.start();
    expect(await t.start()).toMatchObject({ ok: false });
    t.exit(1);
    expect(await first).toMatchObject({ ok: false });
  });
  it('cancels on quit and waits for the worker to clean up before returning', async () => {
    const t = setup();
    const exporting = t.start();
    const stopping = t.service.stop();
    const request = t.sent[0];
    if (!request || request.type !== 'export-kirtans') throw new Error('Wrong worker request');
    expect(t.sent[1]).toEqual({ type: 'cancel', runId: request.requestId });
    t.reply({
      type: 'exported-kirtans',
      requestId: request.requestId,
      result: { ok: false, message: 'Cancelled.' },
    });
    expect(await exporting).toMatchObject({ ok: false });
    await stopping;
    expect(await t.start()).toMatchObject({ ok: false });
  });
});
