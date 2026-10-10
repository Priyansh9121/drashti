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
  /**
   * Run the worker at normal priority (true) or its own lowest (false) (Session 16): while the main
   * process waits for it to give way, so that waiting is not for a process starved of the processor.
   */
  boost?(on: boolean): void;
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
  /** Drashti is quitting: nothing more starts, and what the stopped worker says after is not heard. */
  private stopped = false;
  private active: {
    job: Job;
    worker: WorkerProcess;
    drawing: AbortController;
    /** The main process's writes waiting for the import to give way, by request. */
    ways: Map<string, (how?: 'waiting' | 'at once' | 'limit' | 'ended') => void>;
    /** Writes waiting for the import, or let in and not done yet: while any are, it runs at normal priority. */
    boosted: number;
  } | null = null;

  /** How giving way has gone (for the performance check): answers, how long they took, and limits reached. */
  readonly wayStats = {
    /** Edits during an import that found the write lock free at once. */
    free: 0,
    /** ...that found it free before the import had given way (its group's own commit). */
    freedMeanwhile: 0,
    asked: 0,
    answeredWaiting: 0,
    answeredAtOnce: 0,
    limit: 0,
    slowestMs: 0,
  };

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
   * Before the main process writes to the library while the import holds the write lock (an
   * operator's edit; Session 16): ask the import to give way between files (it commits its group and
   * waits), running it at normal priority meanwhile. `ready` resolves when it has (or after `maxMs`,
   * or when the run ends); `done` must be called once the write is done, whenever that is.
   */
  giveWay(maxMs = GIVE_WAY_WAIT_MS): { ready: Promise<void>; done: () => void } {
    const active = this.active;
    if (!active) return { ready: Promise.resolve(), done: () => undefined };
    const id = randomUUID();
    const asked = performance.now();
    this.wayStats.asked++;
    // The import gets the processor it needs to reach the end of its file until the write is done.
    if (active.boosted++ === 0) active.worker.boost?.(true);
    let ended = false;
    const done = () => {
      if (ended) return;
      ended = true;
      if (--active.boosted === 0) active.worker.boost?.(false);
      if (this.active === active) active.worker.postMessage({ type: 'go-on', id });
    };
    const ready = new Promise<void>((resolve) => {
      const answered = (how: 'waiting' | 'at once' | 'limit' | 'ended' = 'ended') => {
        clearTimeout(timer);
        active.ways.delete(id);
        const ms = performance.now() - asked;
        if (how === 'waiting') this.wayStats.answeredWaiting++;
        else if (how === 'at once') this.wayStats.answeredAtOnce++;
        else if (how === 'limit') this.wayStats.limit++;
        this.wayStats.slowestMs = Math.max(this.wayStats.slowestMs, Math.round(ms));
        resolve();
      };
      const timer = setTimeout(() => {
        answered('limit');
      }, maxMs);
      active.ways.set(id, answered);
      active.worker.postMessage({ type: 'give-way', id });
    });
    return { ready, done };
  }

  /**
   * Stop everything (the app is quitting). An import cut short is recorded now, while the library is
   * still open (Session 23: the worker's exit came after the library had closed, and recording it then
   * threw an uncaught exception).
   */
  stop(): void {
    this.stopped = true;
    for (const job of this.queue.splice(0)) job.resolve({ ok: false, message: 'Drashti is quitting.' });
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.drawing.abort();
    for (const done of [...active.ways.values()]) done();
    active.worker.kill();
    this.deps.log('info', `Import ${active.job.runId} stopped: Drashti is quitting`);
    this.recordFailure(active.job, 'Drashti quit before the import finished.');
    active.job.resolve({ ok: false, message: 'Drashti is quitting.' });
  }

  private next(): void {
    if (this.active || this.stopped) return;
    const job = this.queue.shift();
    if (!job) return;
    let worker: WorkerProcess;
    try {
      worker = this.deps.spawn();
    } catch (error) {
      const message = 'Could not start the import. Try again; if it happens again, restart Drashti.';
      this.deps.log(
        'warn',
        `Could not start the import: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      boosted: 0,
    };
    this.active = active;
    let settled = false;
    const settle = (result: ImportResult, run: ImportRunSummary | null) => {
      if (settled || this.stopped) return;
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
      if (this.stopped) return;
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
      if (settled || this.stopped) return;
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
