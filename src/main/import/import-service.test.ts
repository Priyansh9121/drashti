import { describe, expect, it, vi } from 'vitest';
import type { ImportProgress, ImportRunSummary } from '../../shared/import';
import { emptyTotals } from '../../shared/import';
import { ImportService, type ImportServiceDeps, type WorkerProcess } from './import-service';
import type { FromWorker, ToWorker } from './protocol';

class FakeWorker implements WorkerProcess {
  sent: ToWorker[] = [];
  killed = false;
  private messageListener: (m: FromWorker) => void = () => undefined;
  private exitListener: (code: number) => void = () => undefined;
  postMessage(message: ToWorker) {
    this.sent.push(message);
  }
  onMessage(listener: (m: FromWorker) => void) {
    this.messageListener = listener;
  }
  onExit(listener: (code: number) => void) {
    this.exitListener = listener;
  }
  kill() {
    this.killed = true;
  }
  emit(m: FromWorker) {
    this.messageListener(m);
  }
  exit(code: number) {
    this.exitListener(code);
  }
  get runId(): string {
    const start = this.sent.find((m) => m.type === 'start');
    return start?.runId ?? '';
  }
}

const summary = (id: string): ImportRunSummary => ({
  id,
  status: 'done',
  startedAt: '2026-09-28T00:00:00.000Z',
  finishedAt: '2026-09-28T00:00:01.000Z',
  paths: ['/x'],
  totals: emptyTotals(),
  message: null,
});

function setup(overrides: Partial<ImportServiceDeps> = {}) {
  const workers: FakeWorker[] = [];
  const mocks = {
    onProgress: vi.fn<(progress: ImportProgress) => void>(),
    onWrote: vi.fn<ImportServiceDeps['onWrote']>(),
    onFinished: vi.fn<ImportServiceDeps['onFinished']>(),
    failRun: vi.fn<ImportServiceDeps['failRun']>(),
  };
  const deps: ImportServiceDeps = {
    spawn: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    worker: {
      dbFile: '/data/drashti.sqlite',
      mediaDir: '/data/Media',
      userDataDir: '/data',
      schemaVersion: 2,
    },
    ...mocks,
    log: () => undefined,
    exitGraceMs: 5,
    ...overrides,
  };
  return { service: new ImportService(deps), mocks, workers };
}

describe('ImportService', () => {
  it('runs an import in a worker and passes its messages on', async () => {
    const { service, mocks, workers } = setup();
    const done = service.start(['/lyrics'], { onConflict: 'skip' });
    const w = workers[0];
    expect(w?.sent).toEqual([
      {
        type: 'start',
        runId: w?.runId,
        paths: ['/lyrics'],
        options: { onConflict: 'skip' },
        dbFile: '/data/drashti.sqlite',
        mediaDir: '/data/Media',
        userDataDir: '/data',
        schemaVersion: 2,
      },
    ]);
    expect(mocks.onProgress).toHaveBeenCalledWith({
      runId: w?.runId,
      phase: 'queued',
      done: 0,
      total: 0,
      current: null,
    });
    expect(service.busy).toBe(true);
    const progress = {
      runId: w?.runId ?? '',
      phase: 'importing' as const,
      done: 1,
      total: 2,
      current: 'a.txt',
    };
    w?.emit({ type: 'progress', progress });
    w?.emit({ type: 'wrote', runId: w.runId, presentationId: 'p1', replaced: false });
    w?.emit({ type: 'finished', run: summary(w.runId) });
    await expect(done).resolves.toEqual({ ok: true, run: summary(w?.runId ?? '') });
    expect(mocks.onProgress).toHaveBeenLastCalledWith(progress);
    expect(mocks.onWrote).toHaveBeenCalledWith({ presentationId: 'p1', replaced: false });
    expect(mocks.onFinished).toHaveBeenCalledWith(summary(w?.runId ?? ''));
    expect(service.busy).toBe(false);
    // A worker that does not exit by itself is stopped.
    await vi.waitFor(() => expect(w?.killed).toBe(true));
  });

  it('runs one import at a time, in order', async () => {
    const { service, workers } = setup();
    const first = service.start(['/a']);
    const second = service.start(['/b']);
    expect(workers).toHaveLength(1);
    workers[0]?.emit({ type: 'finished', run: summary(workers[0].runId) });
    await first;
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent[0]).toMatchObject({ type: 'start', paths: ['/b'] });
    workers[1]?.emit({ type: 'failed', runId: workers[1].runId, message: 'disk on fire' });
    await expect(second).resolves.toEqual({ ok: false, message: 'disk on fire' });
  });

  it('records a run as failed when its worker dies', async () => {
    const { service, mocks, workers } = setup();
    const done = service.start(['/a']);
    const w = workers[0];
    w?.exit(9);
    await expect(done).resolves.toEqual({
      ok: false,
      message: 'The import stopped unexpectedly (exit code 9).',
    });
    expect(mocks.failRun).toHaveBeenCalledWith(
      w?.runId,
      ['/a'],
      'The import stopped unexpectedly (exit code 9).',
    );
    expect(mocks.onFinished).toHaveBeenCalledWith(null);
  });

  it('reports a worker that cannot start', async () => {
    const { service, mocks } = setup({
      spawn: () => {
        throw new Error('no such file');
      },
    });
    await expect(service.start(['/a'])).resolves.toEqual({
      ok: false,
      message: 'Could not start the import: no such file',
    });
    expect(mocks.failRun).toHaveBeenCalledTimes(1);
  });

  it('cancels a waiting run before it starts, and asks a running one to stop', async () => {
    const { service, mocks, workers } = setup();
    void service.start(['/a']);
    const waiting = service.start(['/b']);
    expect(workers).toHaveLength(1);
    // Every run announces its id as soon as it is queued.
    const queued = mocks.onProgress.mock.calls.map(([p]) => p.runId);
    expect(queued).toHaveLength(2);
    expect(service.cancel(queued[1] ?? '')).toBe(true);
    await expect(waiting).resolves.toEqual({ ok: false, message: 'Cancelled before it started.' });
    const active = workers[0];
    expect(service.cancel(active?.runId ?? '')).toBe(true);
    expect(active?.sent.at(-1)).toEqual({ type: 'cancel', runId: active?.runId });
    expect(service.cancel('nope')).toBe(false);
  });

  it('stops everything when the app quits', async () => {
    const { service, workers } = setup();
    void service.start(['/a']);
    const waiting = service.start(['/b']);
    service.stop();
    await expect(waiting).resolves.toEqual({ ok: false, message: 'Drashti is quitting.' });
    expect(workers[0]?.killed).toBe(true);
  });
});
