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
  boosts: boolean[] = [];
  boost(on: boolean) {
    this.boosts.push(on);
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
        job: 'import',
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
    // The result is the worker's last message: it is stopped then (it never exits by itself first).
    expect(w?.killed).toBe(true);
  });

  it('tells each import whether this computer plays HEVC; one starting before the window has said waits for it (Session 51)', async () => {
    let tell: (plays: boolean | null) => void = () => undefined;
    const answer = new Promise<boolean | null>((resolve) => {
      tell = resolve;
    });
    const { service, workers } = setup({ playsHevc: () => answer });
    const first = service.start(['/Placeholder phone.mov']);
    await Promise.resolve();
    // Not started before the window has said (Session 51 review: HEVC from the first moments went in as it was).
    expect(workers[0]?.sent).toEqual([]);
    tell(false);
    await vi.waitFor(() => {
      expect(workers[0]?.sent[0]).toMatchObject({ type: 'start', playsHevc: false });
    });
    workers[0]?.emit({ type: 'finished', run: summary(workers[0].runId) });
    await first;
  });

  it('an import stopped while it waits for the answer never starts', async () => {
    let tell: (plays: boolean | null) => void = () => undefined;
    const answer = new Promise<boolean | null>((resolve) => {
      tell = resolve;
    });
    const { service, workers } = setup({ playsHevc: () => answer });
    const run = service.start(['/Placeholder phone.mov']);
    service.stop();
    await expect(run).resolves.toEqual({ ok: false, message: 'Drashti is quitting.' });
    tell(true);
    await answer;
    await Promise.resolve();
    expect(workers[0]?.sent).toEqual([]);
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

  it('does not count the worker stopping after its result as a failure', async () => {
    const { service, mocks, workers } = setup();
    const done = service.start(['/a']);
    const w = workers[0];
    w?.emit({ type: 'finished', run: summary(w.runId) });
    w?.exit(0);
    await expect(done).resolves.toMatchObject({ ok: true });
    expect(mocks.failRun).not.toHaveBeenCalled();
  });

  it('records a run as failed when its worker dies', async () => {
    const { service, mocks, workers } = setup();
    const done = service.start(['/a']);
    const w = workers[0];
    w?.exit(9);
    // What happened and what to do; the exit code goes to the log only.
    const said =
      'The import stopped unexpectedly: import the files again; if it stops again, choose Help, then Save Diagnostics…, and tell the admin.';
    await expect(done).resolves.toEqual({ ok: false, message: said });
    expect(mocks.failRun).toHaveBeenCalledWith(w?.runId, ['/a'], said);
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
      message: 'Could not start the import. Try again; if it happens again, restart Drashti.',
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

  it('at quit, records the run cut short while the library is open, and never touches it after (Session 23)', async () => {
    const { service, mocks, workers } = setup();
    const running = service.start(['/a']);
    service.stop();
    await expect(running).resolves.toEqual({ ok: false, message: 'Drashti is quitting.' });
    expect(mocks.failRun).toHaveBeenCalledTimes(1);
    expect(mocks.failRun.mock.calls[0]?.[2]).toBe('Drashti quit before the import finished.');
    // The library closes now; the killed worker's last words and exit come after it.
    mocks.failRun.mockImplementation(() => {
      throw new TypeError('The database connection is not open');
    });
    mocks.onFinished.mockImplementation(() => {
      throw new TypeError('The database connection is not open');
    });
    const w = workers[0];
    w?.emit({ type: 'failed', runId: w.runId, message: 'killed' });
    w?.exit(1);
    expect(mocks.failRun).toHaveBeenCalledTimes(1);
    expect(mocks.onFinished).not.toHaveBeenCalled();
    // Nothing new starts while Drashti quits.
    void service.start(['/b']);
    expect(workers).toHaveLength(1);
  });
});

describe('ImportService and pictures (Session 15)', () => {
  it('has the main process draw a PDF for the worker, and stops the drawing when the run is cancelled', async () => {
    const asked: { pdf: string; outDir: string; signal: AbortSignal }[] = [];
    let answer: (result: { ok: false; message: string }) => void = () => undefined;
    const { service, workers } = setup({
      drawPdf: (pdf, outDir, signal) => {
        asked.push({ pdf, outDir, signal });
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    const done = service.start(['/decks']);
    const w = workers[0];
    if (!w) throw new Error('no worker');
    w.emit({ type: 'draw-pdf', requestId: 'r1', pdf: '/decks/a.pdf', outDir: '/tmp/pages' });
    expect(asked.map((a) => [a.pdf, a.outDir])).toEqual([['/decks/a.pdf', '/tmp/pages']]);
    answer({ ok: false, message: 'Placeholder reason.' });
    await Promise.resolve();
    await Promise.resolve();
    expect(w.sent.at(-1)).toEqual({
      type: 'drawn',
      requestId: 'r1',
      result: { ok: false, message: 'Placeholder reason.' },
    });
    // Cancelling the run stops a drawing under way.
    w.emit({ type: 'draw-pdf', requestId: 'r2', pdf: '/decks/b.pdf', outDir: '/tmp/pages-b' });
    expect(asked[1]?.signal.aborted).toBe(false);
    service.cancel(w.runId);
    expect(asked[1]?.signal.aborted).toBe(true);
    w.emit({ type: 'finished', run: summary(w.runId) });
    await done;
  });

  describe('giving way to the main process’s writes (Session 16)', () => {
    it('lets a write go at once when no import runs', async () => {
      const { service } = setup();
      const way = service.giveWay();
      await way.ready;
      expect(typeof way.done).toBe('function');
    });

    it('asks the running import to give way, waits for it, and tells it to go on once written', async () => {
      const { service, workers } = setup();
      void service.start(['/x']);
      const w = workers[0];
      if (!w) throw new Error('no worker');
      let let_in = false;
      const way = service.giveWay();
      const waiting = way.ready.then(() => {
        let_in = true;
      });
      const ask = w.sent.find((m) => m.type === 'give-way');
      expect(ask).toBeDefined();
      // Raised to normal priority while the write waits, so it is not waiting on a starved process.
      expect(w.boosts).toEqual([true]);
      await Promise.resolve();
      expect(let_in).toBe(false);
      w.emit({ type: 'gave-way', id: ask?.id ?? '', waiting: true });
      await waiting;
      expect(let_in).toBe(true);
      way.done();
      expect(w.sent.at(-1)).toEqual({ type: 'go-on', id: ask?.id });
      expect(w.boosts).toEqual([true, false]);
    });

    it('goes ahead after its limit if the import does not answer, and when the run ends', async () => {
      vi.useFakeTimers();
      try {
        const { service, workers } = setup();
        void service.start(['/x']);
        const w = workers[0];
        if (!w) throw new Error('no worker');
        let first = false;
        void service.giveWay(1500).ready.then(() => (first = true));
        await vi.advanceTimersByTimeAsync(1499);
        expect(first).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(first).toBe(true);
        let second = false;
        void service.giveWay(1500).ready.then(() => (second = true));
        w.emit({ type: 'finished', run: summary(w.runId) });
        await vi.advanceTimersByTimeAsync(0);
        expect(second).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
