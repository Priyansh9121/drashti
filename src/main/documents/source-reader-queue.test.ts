import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedSource } from '../../shared/editable-source';
import type { SourceRead } from './source-reader';
import { SourceReaderQueue } from './source-reader-queue';

const success: PreparedSource = { ok: true, pages: [], total: 0, failed: [] };
const request = (signal = new AbortController().signal): SourceRead => ({
  ext: 'pdf',
  file: '/Placeholder/source.pdf',
  outDir: '/Placeholder/generated',
  sourcePages: [0],
  signal,
  checkpoint: () => Promise.resolve(true),
});
afterEach(() => vi.useRealTimers());

describe('source preparation admission', () => {
  it('runs one source at a time and refuses excess waiting work', async () => {
    const finish: ((result: PreparedSource) => void)[] = [];
    const read = vi.fn(() => new Promise<PreparedSource>((resolve) => finish.push(resolve)));
    const queue = new SourceReaderQueue(read, { pending: 1 });
    const first = queue.read(request());
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1), { interval: 1 });
    const second = queue.read(request());
    expect((await queue.read(request())).ok).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    finish[0]?.(success);
    expect(await first).toEqual(success);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), { interval: 1 });
    finish[1]?.(success);
    expect(await second).toEqual(success);
    await queue.stop();
  });

  it('removes a cancelled waiting job without opening a reader', async () => {
    let complete: ((result: PreparedSource) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<PreparedSource>((resolve) => {
          complete = resolve;
        }),
    );
    const queue = new SourceReaderQueue(read);
    const first = queue.read(request());
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1), { interval: 1 });
    const cancelled = new AbortController();
    const second = queue.read(request(cancelled.signal));
    cancelled.abort();
    expect((await second).ok).toBe(false);
    complete?.(success);
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    await queue.stop();
  });

  it('bounds a hanging admission guard and cancels active work on its whole-job deadline', async () => {
    vi.useFakeTimers();
    const read = vi.fn(() => Promise.resolve(success));
    const queue = new SourceReaderQueue(read, { timeoutMs: 50 });
    const waiting = queue.read({ ...request(), checkpoint: () => new Promise<boolean>(() => undefined) });
    await vi.advanceTimersByTimeAsync(51);
    expect((await waiting).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
    await queue.stop();

    const activeRead = vi.fn(
      (job: SourceRead) =>
        new Promise<PreparedSource>((resolve) => {
          job.signal.addEventListener(
            'abort',
            () => resolve({ ok: false, message: 'Placeholder cancellation' }),
            { once: true },
          );
        }),
    );
    const active = new SourceReaderQueue(activeRead, { timeoutMs: 50 });
    const pending = active.read(request());
    await vi.advanceTimersByTimeAsync(1);
    expect(activeRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).ok).toBe(false);
    await active.stop();
  });

  it('blocks further preparation after an unconfirmed child exit and drains owned work before stopping', async () => {
    const read = vi.fn(() =>
      Promise.resolve<PreparedSource>({
        ok: false,
        message: 'Placeholder unconfirmed exit',
        retainOutput: true,
      }),
    );
    const queue = new SourceReaderQueue(read);
    expect(await queue.read(request())).toMatchObject({ ok: false, retainOutput: true });
    expect((await queue.read(request())).ok).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    await queue.stop();
  });
});
