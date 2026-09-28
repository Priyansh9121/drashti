import { randomUUID } from 'node:crypto';
import type { ImportOptions, ImportProgress, ImportResult, ImportRunSummary } from '../../shared/import';
import type { FromWorker, StartMessage, ToWorker } from './protocol';

/*
 * Runs imports one at a time, each in a fresh worker process (see
 * worker.ts). The main process only passes messages along, so a big import
 * never delays the show.
 */

/** The parts of a worker process the service uses (tests pass a fake). */
export interface WorkerProcess {
  postMessage(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface ImportServiceDeps {
  spawn(): WorkerProcess;
  worker: Omit<StartMessage, 'type' | 'runId' | 'paths' | 'options'>;
  onProgress(progress: ImportProgress): void;
  onWrote(wrote: { presentationId: string; replaced: boolean }): void;
  /** After every run, with its summary when it finished. */
  onFinished(run: ImportRunSummary | null): void;
  /** Record a run as failed (its worker died or could not start). */
  failRun(runId: string, paths: string[], message: string): void;
  log(level: 'info' | 'warn', message: string): void;
  /** How long a finished worker may take to exit before it is stopped. */
  exitGraceMs?: number;
}

interface Job {
  runId: string;
  paths: string[];
  options: ImportOptions;
  resolve(result: ImportResult): void;
}

export class ImportService {
  private readonly queue: Job[] = [];
  private active: { job: Job; worker: WorkerProcess } | null = null;

  constructor(private readonly deps: ImportServiceDeps) {}

  /** True while a run is going or waiting. */
  get busy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  get activeRunId(): string | null {
    return this.active?.job.runId ?? null;
  }

  /** Import files and folders. Resolves when the run has ended. */
  start(paths: string[], options: ImportOptions = {}): Promise<ImportResult> {
    return new Promise((resolve) => {
      const job: Job = { runId: randomUUID(), paths, options, resolve };
      this.queue.push(job);
      this.deps.onProgress({ runId: job.runId, phase: 'queued', done: 0, total: 0, current: null });
      this.next();
    });
  }

  /** Stop a run: a waiting one never starts; a running one stops after the file it is on. */
  cancel(runId: string): boolean {
    const waiting = this.queue.findIndex((j) => j.runId === runId);
    if (waiting >= 0) {
      const [job] = this.queue.splice(waiting, 1);
      job?.resolve({ ok: false, message: 'Cancelled before it started.' });
      return true;
    }
    if (this.active?.job.runId === runId) {
      this.active.worker.postMessage({ type: 'cancel', runId });
      return true;
    }
    return false;
  }

  /** Stop everything (the app is quitting). */
  stop(): void {
    for (const job of this.queue.splice(0)) job.resolve({ ok: false, message: 'Drashti is quitting.' });
    this.active?.worker.kill();
  }

  private next(): void {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    let worker: WorkerProcess;
    try {
      worker = this.deps.spawn();
    } catch (error) {
      const message = `Could not start the import: ${error instanceof Error ? error.message : String(error)}`;
      this.deps.log('warn', message);
      this.recordFailure(job, message);
      job.resolve({ ok: false, message });
      this.deps.onFinished(null);
      this.next();
      return;
    }
    const active = { job, worker };
    this.active = active;
    let settled = false;
    let exited = false;
    const settle = (result: ImportResult, run: ImportRunSummary | null) => {
      if (settled) return;
      settled = true;
      if (this.active === active) this.active = null;
      job.resolve(result);
      this.deps.onFinished(run);
      // The worker exits by itself; stop it if it does not.
      if (!exited) {
        setTimeout(() => {
          if (!exited) worker.kill();
        }, this.deps.exitGraceMs ?? 10_000).unref();
      }
      this.next();
    };
    worker.onMessage((m) => {
      switch (m.type) {
        case 'progress':
          if (m.progress.runId === job.runId) this.deps.onProgress(m.progress);
          break;
        case 'wrote':
          this.deps.onWrote({ presentationId: m.presentationId, replaced: m.replaced });
          break;
        case 'finished':
          this.deps.log('info', `Import ${job.runId} ${m.run.status}: ${JSON.stringify(m.run.totals)}`);
          settle({ ok: true, run: m.run }, m.run);
          break;
        case 'failed':
          this.deps.log('warn', `Import ${job.runId} failed: ${m.message}`);
          settle({ ok: false, message: m.message }, null);
          break;
      }
    });
    worker.onExit((code) => {
      exited = true;
      if (settled) return;
      const message = `The import stopped unexpectedly (exit code ${code}).`;
      this.deps.log('warn', message);
      this.recordFailure(job, message);
      settle({ ok: false, message }, null);
    });
    worker.postMessage({
      type: 'start',
      runId: job.runId,
      paths: job.paths,
      options: job.options,
      ...this.deps.worker,
    });
  }

  private recordFailure(job: Job, message: string): void {
    try {
      this.deps.failRun(job.runId, job.paths, message);
    } catch (error) {
      this.deps.log('warn', `Could not record the failed import: ${String(error)}`);
    }
  }
}
