import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { workNow } from './work-time';

/*
 * The speed tests' clock (Session 58, h-flaky): it counts the work the thread does, and never the moments the
 * computer gives to other programs, so a speed test's budget holds on a busy computer as on a quiet one.
 */

const DATA = Buffer.alloc(4 * 1024 * 1024, 7);

/** How long the clock says hashing 4 MB `times` times took. */
function hashing(times: number): number {
  const start = workNow();
  for (let i = 0; i < times; i++) createHash('sha256').update(DATA).digest();
  return workNow() - start;
}

describe('the speed tests’ clock', () => {
  it('counts the work the thread does: twice the work, about twice the time', () => {
    hashing(1);
    const once = hashing(4);
    const twice = hashing(8);
    expect(once).toBeGreaterThan(0);
    expect(twice).toBeGreaterThan(1.4 * once);
  });

  // Windows has no SIGSTOP, and there the clock is the wall clock (work-time.ts).
  it.skipIf(process.platform === 'win32')(
    'leaves out the time the computer kept the process stopped, as a busy computer does',
    () => {
      const start = workNow();
      const clock = performance.now();
      // Another program stops this one for 0.3 s, then lets it go on.
      const pid = String(process.pid);
      spawnSync('/bin/sh', ['-c', `kill -STOP ${pid}; sleep 0.3; kill -CONT ${pid}`]);
      expect(performance.now() - clock).toBeGreaterThan(300);
      expect(workNow() - start).toBeLessThan(100);
    },
  );
});
