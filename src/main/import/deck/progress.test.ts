import { describe, expect, it } from 'vitest';
import { cpuTimeMs, noProgress, type Progress } from './progress';

/*
 * A deck's movie that makes no progress for a minute is given up on (Session 54, C review): progress is the movie
 * growing or its app at work (half a second of processor time since the last progress); an app waiting on a
 * question nobody sees uses next to none.
 */

/** `read` giving these, then the last again and again; how many times it was read. */
function reads(samples: Progress[]): { read: () => Promise<Progress>; count: () => number } {
  let i = 0;
  return {
    read: () => Promise.resolve(samples[Math.min(i++, samples.length - 1)] ?? { cpuMs: null, bytes: null }),
    count: () => i,
  };
}

describe('a movie making no progress', () => {
  it('is given up on once the movie has not grown and the app has not worked for the time given', async () => {
    const { read } = reads([{ cpuMs: 1000, bytes: null }]);
    const started = Date.now();
    expect(await noProgress(read, { signal: new AbortController().signal, stallMs: 150, everyMs: 10 })).toBe(
      'stalled',
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it('goes on while the movie grows, or while the app works, and is given up on a time after they stop', async () => {
    const growing: Progress[] = Array.from({ length: 20 }, (_, i) => ({ cpuMs: 1000, bytes: i * 1000 }));
    const working: Progress[] = Array.from({ length: 20 }, (_, i) => ({
      cpuMs: 1000 + i * 600,
      bytes: null,
    }));
    for (const samples of [growing, working]) {
      const { read, count } = reads(samples);
      expect(
        await noProgress(read, { signal: new AbortController().signal, stallMs: 100, everyMs: 10 }),
      ).toBe('stalled');
      // Every sample of progress read, then the time given without any.
      expect(count()).toBeGreaterThan(samples.length);
    }
  });

  it('a little processor time, as an app waiting on a question uses, is no progress', async () => {
    const idle: Progress[] = Array.from({ length: 1000 }, (_, i) => ({ cpuMs: 1000 + i * 2, bytes: 4096 }));
    const { read, count } = reads(idle);
    expect(await noProgress(read, { signal: new AbortController().signal, stallMs: 150, everyMs: 10 })).toBe(
      'stalled',
    );
    expect(count()).toBeLessThan(250);
  });

  it('half a second of processor time since the last progress, however slowly it came, is progress', async () => {
    // 100 ms a read: the fifth read since the mark is progress, so it never stalls within 400 reads.
    const slow: Progress[] = Array.from({ length: 400 }, (_, i) => ({ cpuMs: 1000 + i * 100, bytes: null }));
    const { read, count } = reads(slow);
    expect(await noProgress(read, { signal: new AbortController().signal, stallMs: 60, everyMs: 10 })).toBe(
      'stalled',
    );
    expect(count()).toBeGreaterThan(400);
  });

  it('stops when told', async () => {
    const stop = new AbortController();
    const { read } = reads([{ cpuMs: null, bytes: null }]);
    setTimeout(() => {
      stop.abort();
    }, 30);
    expect(await noProgress(read, { signal: stop.signal, stallMs: 60_000, everyMs: 10 })).toBe('stopped');
  });
});

describe('ps’s processor time', () => {
  it('reads minutes and seconds, hours and days, and adds up the processes', () => {
    expect(cpuTimeMs('  0:01.23\n')).toBe(1230);
    expect(cpuTimeMs('248:35.20')).toBe((248 * 60 + 35.2) * 1000);
    expect(cpuTimeMs('1:02:03.5')).toBe((3600 + 2 * 60 + 3.5) * 1000);
    expect(cpuTimeMs('2-01:00:00')).toBe((2 * 24 + 1) * 3_600_000);
    expect(cpuTimeMs('  0:01.00\n  0:02.50\n')).toBe(3500);
    expect(cpuTimeMs('')).toBeNull();
  });
});
