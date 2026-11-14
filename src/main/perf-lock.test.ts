import { describe, expect, it } from 'vitest';
import { LockWatch } from './perf-lock';

describe('the library’s write lock as the main process sees it while measured (Session 58)', () => {
  it('counts the looks it was taken, and times each span it stayed taken, a span open at the end to then', () => {
    let clock = 0;
    let tick: () => void = () => undefined;
    const free = [true, false, false, false, true, false, true, false];
    let i = 0;
    const watch = new LockWatch({
      free: () => free[i] ?? true,
      now: () => clock,
      every: (_ms, run) => {
        tick = run;
        return () => {
          tick = () => undefined;
        };
      },
    });
    watch.begin();
    for (i = 0; i < free.length; i++) {
      clock = i * 100;
      tick();
    }
    clock = 900;
    watch.end();
    expect(watch.line()).toBe(
      'the library’s write lock as the main process saw it (looked at every 100 ms, never waited for): taken at 5 of 8 looks, its longest hold 300 ms, holds of 0.5/1/2 s or more: 0/0/0',
    );
  });

  it('a look that fails is not counted', () => {
    let tick: () => void = () => undefined;
    const watch = new LockWatch({
      free: () => {
        throw new Error('Placeholder: the library closed');
      },
      every: (_ms, run) => {
        tick = run;
        return () => undefined;
      },
    });
    watch.begin();
    tick();
    watch.end();
    expect(watch.line()).toContain('taken at 0 of 0 looks');
  });
});
