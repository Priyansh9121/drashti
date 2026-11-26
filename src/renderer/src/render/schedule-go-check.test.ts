import { afterEach, expect, it, vi } from 'vitest';
import { scheduleGoCheck } from './schedule-go-check';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps a check not asked to go first (a later start that is no cue) on its timer, even with the task scheduler present', () => {
  vi.useFakeTimers();
  const task = vi.fn();
  vi.stubGlobal('scheduler', { postTask: task });
  const run = vi.fn();
  const cancel = scheduleGoCheck(run, 120, false);
  vi.advanceTimersByTime(119);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(task).not.toHaveBeenCalled();
  cancel();
});

it('aborts a superseded or stopped LIVE Go task', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('scheduler', {
    postTask: (_run: () => void, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  });
  const cancel = scheduleGoCheck(vi.fn(), 120, true);
  expect(signal?.aborted).toBe(false);
  cancel();
  expect(signal?.aborted).toBe(true);
  await Promise.resolve();
});

it('retains a cancellable clock check where the browser has no task scheduler', () => {
  vi.useFakeTimers();
  vi.stubGlobal('scheduler', undefined);
  const run = vi.fn();
  const cancel = scheduleGoCheck(run, 120, true);
  cancel();
  vi.advanceTimersByTime(120);
  expect(run).not.toHaveBeenCalled();
});
