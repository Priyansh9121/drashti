import { EDITABLE_SOURCE_LIMITS, type PreparedSource } from '../../shared/editable-source';
import { sourceCheckpoint, type SourceRead, type SourceReader } from './source-reader';

const refused = (): PreparedSource => ({
  ok: false,
  message:
    'Reading the original’s words and shapes stopped, or can’t start now. The slides still show as before.',
});
interface Queued {
  request: SourceRead;
  controller: AbortController;
  done: Promise<void>;
  finish(result: PreparedSource): void;
}
interface QueueOptions {
  pending?: number;
  timeoutMs?: number;
  exitGraceMs?: number;
}

/** One source job, including its entire queued lifetime, across hidden PDF and PPTX utility adapters. */
export class SourceReaderQueue {
  private waiting: Queued[] = [];
  private active: Queued | null = null;
  private stopped = false;
  private isStopped(): boolean {
    return this.stopped;
  }
  constructor(
    private readonly readSource: SourceReader,
    private readonly options: QueueOptions = {},
  ) {}

  read: SourceReader = (request) => {
    if (
      this.stopped ||
      request.signal.aborted ||
      this.waiting.length >= (this.options.pending ?? EDITABLE_SOURCE_LIMITS.pending) ||
      request.file.length > 32_768 ||
      request.outDir.length > 32_768 ||
      !request.sourcePages.length ||
      request.sourcePages.length > EDITABLE_SOURCE_LIMITS.pages ||
      new Set(request.sourcePages).size !== request.sourcePages.length ||
      request.sourcePages.some((index) => !Number.isInteger(index) || index < 0 || index > 1_000_000)
    )
      return Promise.resolve(refused());
    return new Promise<PreparedSource>((resolve) => {
      const controller = new AbortController();
      const timeoutMs = this.options.timeoutMs ?? EDITABLE_SOURCE_LIMITS.timeoutMs;
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let drained: () => void = () => undefined;
      const done = new Promise<void>((finish) => {
        drained = finish;
      });
      const abort = () => {
        controller.abort();
        const index = this.waiting.indexOf(job);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          job.finish(refused());
        } else if (this.active === job && !grace) {
          grace = setTimeout(() => {
            this.stopped = true;
            job.finish({
              ok: false,
              message:
                'Drashti’s document reader did not stop. Restart Drashti before editing more imported slides.',
              retainOutput: true,
            });
            for (const waiting of this.waiting.splice(0)) {
              waiting.controller.abort();
              waiting.finish(refused());
            }
          }, this.options.exitGraceMs ?? 4_000);
        }
      };
      const timer = setTimeout(abort, timeoutMs);
      const job: Queued = {
        request: { ...request, signal: controller.signal, deadlineAt: performance.now() + timeoutMs },
        controller,
        done,
        finish: (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (grace) clearTimeout(grace);
          request.signal.removeEventListener('abort', abort);
          if (!result.ok && result.retainOutput) this.stopped = true;
          resolve(result);
          drained();
        },
      };
      request.signal.addEventListener('abort', abort, { once: true });
      this.waiting.push(job);
      if (request.signal.aborted) abort();
      void this.pump();
    });
  };

  private async pump(): Promise<void> {
    if (this.active || this.isStopped()) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.active = job;
    try {
      if (!(await sourceCheckpoint(job.request))) job.finish(refused());
      else {
        const result = await this.readSource(job.request);
        job.finish(job.controller.signal.aborted && (result.ok || !result.retainOutput) ? refused() : result);
      }
    } catch {
      job.finish(refused());
    } finally {
      this.active = null;
      if (this.isStopped())
        for (const waiting of this.waiting.splice(0)) {
          waiting.controller.abort();
          waiting.finish(refused());
        }
      else void this.pump();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const job of this.waiting.splice(0)) {
      job.controller.abort();
      job.finish(refused());
    }
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    // Signal parent cancellation too, so the normal bounded drain timer is armed.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active.done,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            active.finish({
              ok: false,
              message: 'Drashti’s document reader did not stop.',
              retainOutput: true,
            });
            resolve();
          }, this.options.exitGraceMs ?? 4_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
