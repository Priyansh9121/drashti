import { randomUUID } from 'node:crypto';
import type { ImportOptions, ImportProgress, ImportResult, ImportRunSummary } from '../../shared/import';
import type { PicturesResult } from '../../shared/pictures';
import type { FromWorker, StartMessage, ToWorker } from './protocol';

/*
 * Runs imports one at a time, each in a fresh worker process (see
 * worker.ts). The main process only passes messages along, so a big import
 * never delays the show.
 */

/**
 * How long a write waits for the import to give way before it goes ahead anyway (a file being
 * read or parsed for longer than this: the write then waits for the lock as before).
 */
export const GIVE_WAY_WAIT_MS = 1500;

/** The parts of a worker process the service uses (tests pass a fake). */
export interface WorkerProcess {
  postMessage(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface ImportServiceDeps {
  spawn(): WorkerProcess;
  worker: Omit<StartMessage, 'type' | 'job' | 'runId' | 'paths' | 'options' | 'mediaIds'>;
  onProgress(progress: ImportProgress): void;
  onWrote(wrote: { presentationId: string; replaced: boolean }): void;
  /** After every run, with its summary when it finished. */
  onFinished(run: ImportRunSummary | null): void;
  /** Record a run as failed (its worker died or could not start). */
  failRun(runId: string, paths: string[], message: string): void;
  /** Draw a PDF's pages as pictures for the worker (Session 15): it cannot open the window that draws. */
  drawPdf?(pdf: string, outDir: string, signal: AbortSignal): Promise<PicturesResult>;
  log(level: 'info' | 'warn', message: string): void;
  /** Bring the operator's window back to the front (Keynote or PowerPoint took it, Session 16). */
  refocus?(): void;
}

interface Job {
  job: 'import' | 'relink';
  runId: string;
  paths: string[];
  options: ImportOptions;
  mediaIds?: string[];
  resolve(result: ImportResult): void;
}

export class ImportService {
  private readonly queue: Job[] = [];
  private active: {
    job: Job;
    worker: WorkerProcess;
    drawing: AbortController;
    /** The main process's writes waiting for the import to give way, by request. */
    ways: Map<string, (how?: 'waiting' | 'at once' | 'limit' | 'ended') => void>;
  } | null = null;

  /** How giving way has gone (for the performance check): answers, how long they took, and limits reached. */
  readonly wayStats = { asked: 0, answeredWaiting: 0, answeredAtOnce: 0, limit: 0, slowestMs: 0 };

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
    return this.enqueue({ job: 'import', paths, options });
  }

  /** Look for missing media in a folder (all missing items, or just these). */
  relink(folder: string, mediaIds?: string[]): Promise<ImportResult> {
    return this.enqueue({ job: 'relink', paths: [folder], options: {}, mediaIds });
  }

  private enqueue(work: Omit<Job, 'runId' | 'resolve'>): Promise<ImportResult> {
    return new Promise((resolve) => {
      const job: Job = { ...work, runId: randomUUID(), resolve };
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
      // A PDF being drawn for it stops too.
      this.active.drawing.abort();
      return true;
    }
    return false;
  }

  /**
   * Before the main process writes to the library (an operator's edit; Session 16): while an
   * import runs, ask it to give way between files (it commits its group, holding the write lock no
   * more), so the write does not wait for the group inside the main process, where everything else
   * would wait with it. Resolves with what to call once written; at most `maxMs` later it resolves
   * anyway (the write then waits for the lock as before). Immediately when no import runs.
   */
  giveWay(maxMs = GIVE_WAY_WAIT_MS): Promise<() => void> {
    const active = this.active;
    if (!active) return Promise.resolve(() => undefined);
    const id = randomUUID();
    const asked = performance.now();
    this.wayStats.asked++;
    return new Promise((resolve) => {
      const done = (how: 'waiting' | 'at once' | 'limit' | 'ended' = 'ended') => {
        clearTimeout(timer);
        active.ways.delete(id);
        const ms = performance.now() - asked;
        if (how === 'waiting') this.wayStats.answeredWaiting++;
        else if (how === 'at once') this.wayStats.answeredAtOnce++;
        else if (how === 'limit') this.wayStats.limit++;
        this.wayStats.slowestMs = Math.max(this.wayStats.slowestMs, Math.round(ms));
        resolve(() => {
          if (this.active === active) active.worker.postMessage({ type: 'go-on', id });
        });
      };
      const timer = setTimeout(() => {
        done('limit');
      }, maxMs);
      active.ways.set(id, done);
      active.worker.postMessage({ type: 'give-way', id });
    });
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
    const active = {
      job,
      worker,
      drawing: new AbortController(),
      ways: new Map<string, (how?: 'waiting' | 'at once' | 'limit' | 'ended') => void>(),
    };
    this.active = active;
    let settled = false;
    const settle = (result: ImportResult, run: ImportRunSummary | null) => {
      if (settled) return;
      settled = true;
      active.drawing.abort();
      // Writes waiting for the import to give way need wait no more.
      for (const done of [...active.ways.values()]) done();
      if (this.active === active) this.active = null;
      // The result is the worker's last message (it has closed the library by then): stop it.
      worker.kill();
      job.resolve(result);
      this.deps.onFinished(run);
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
        case 'draw-pdf': {
          const drawn = this.deps.drawPdf
            ? this.deps.drawPdf(m.pdf, m.outDir, active.drawing.signal)
            : Promise.resolve<PicturesResult>({ ok: false, message: 'Pictures cannot be made here.' });
          void drawn
            .catch((error: unknown): PicturesResult => ({ ok: false, message: String(error) }))
            .then((result) => {
              if (!settled) worker.postMessage({ type: 'drawn', requestId: m.requestId, result });
            });
          break;
        }
        case 'finished':
          this.deps.log(
            'info',
            `Import ${job.runId} ${m.run.status}: ${JSON.stringify(m.run.totals)}${m.timings ? `; ms ${JSON.stringify(m.timings)}` : ''}`,
          );
          settle({ ok: true, run: m.run, ...(m.timings ? { timings: m.timings } : {}) }, m.run);
          break;
        case 'log':
          this.deps.log(m.level, m.message);
          break;
        case 'refocus':
          this.deps.refocus?.();
          break;
        case 'gave-way':
          active.ways.get(m.id)?.(m.waiting ? 'waiting' : 'at once');
          break;
        case 'failed':
          this.deps.log('warn', `Import ${job.runId} failed: ${m.message}`);
          settle({ ok: false, message: m.message }, null);
          break;
      }
    });
    worker.onExit((code) => {
      if (settled) return;
      const message = `The import stopped unexpectedly (exit code ${code}).`;
      this.deps.log('warn', message);
      this.recordFailure(job, message);
      settle({ ok: false, message }, null);
    });
    worker.postMessage({
      type: 'start',
      job: job.job,
      runId: job.runId,
      paths: job.paths,
      options: job.options,
      ...(job.mediaIds ? { mediaIds: job.mediaIds } : {}),
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
