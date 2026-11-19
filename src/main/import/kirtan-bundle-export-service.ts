import { randomUUID } from 'node:crypto';
import type { KirtanBundleExportResult } from '../../shared/kirtan-bundles';
import type { WorkerProcess } from './import-service';
import type { ExportKirtansMessage } from './protocol';

interface ExporterDeps {
  spawn(): WorkerProcess;
  dbFile: string;
  mediaDir: string;
  schemaVersion: number;
  onAir?: () => boolean;
}

/** Reuses the low-priority import worker; ZIP/media work never runs in the main process. */
export class KirtanBundleExporter {
  private stopped = false;
  private active: { worker: WorkerProcess; requestId: string; finished: Promise<void> } | null = null;

  constructor(private readonly deps: ExporterDeps) {}

  export(
    request: Pick<ExportKirtansMessage, 'presentationIds' | 'includeMedia' | 'output'>,
  ): Promise<KirtanBundleExportResult> {
    if (this.stopped) return Promise.resolve({ ok: false, message: 'Drashti is quitting.' });
    if (this.active)
      return Promise.resolve({
        ok: false,
        message: 'A kirtan bundle is already being saved. Wait for it to finish.',
      });
    let worker: WorkerProcess;
    try {
      worker = this.deps.spawn();
    } catch {
      return Promise.resolve({ ok: false, message: 'Could not start the bundle export. Try again.' });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      let done: () => void = () => undefined;
      const finished = new Promise<void>((finish) => {
        done = finish;
      });
      const settle = (result: KirtanBundleExportResult) => {
        if (this.active?.requestId !== requestId) return;
        this.active = null;
        worker.kill();
        resolve(result);
        done();
      };
      this.active = { worker, requestId, finished };
      worker.onMessage((message) => {
        if (message.type === 'exported-kirtans' && message.requestId === requestId) settle(message.result);
        if (message.type === 'ask-on-air')
          worker.postMessage({
            type: 'on-air',
            requestId: message.requestId,
            onAir: this.deps.onAir?.() ?? false,
          });
      });
      worker.onExit(() =>
        settle({
          ok: false,
          message:
            'The bundle export stopped before it finished. The earlier saved file was kept. Try again.',
        }),
      );
      try {
        worker.postMessage({
          type: 'export-kirtans',
          requestId,
          dbFile: this.deps.dbFile,
          mediaDir: this.deps.mediaDir,
          schemaVersion: this.deps.schemaVersion,
          ...request,
        });
      } catch {
        settle({ ok: false, message: 'Could not send the bundle export to its worker. Try again.' });
      }
    });
  }

  /** A cooperative stop lets the worker remove its partial file before the library closes. */
  stop(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    if (!active) return Promise.resolve();
    active.worker.postMessage({ type: 'cancel', runId: active.requestId });
    return active.finished;
  }
}
