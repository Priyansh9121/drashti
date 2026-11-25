import { mkdtempSync } from 'node:fs';
import type * as Fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { logLines, logText } from '../../tests/e2e/log-lines';
import { log, startLogFile } from './log';

/*
 * The end-to-end tests' reader of Drashti's log (tests/e2e/log-lines.ts) while Drashti moves a file of it: the first
 * line after this computer's midnight moves drashti.log to its day (log.ts) at any moment, also between the reader's
 * listing of the files and its read of them (a22-review-loglines S1: a one-shot count taken then, as
 * diagnostics.spec.ts's `before`, would read low). Here that moment is made: the listing is the real one, and right
 * after it the real log.ts writes its next line. Placeholder lines only; the clock is the test's own.
 */
const moves = vi.hoisted(() => ({ afterNextListing: null as (() => void) | null }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof Fs>();
  return {
    ...real,
    readdirSync: (...args: unknown[]) => {
      const listed = (real.readdirSync as (...a: unknown[]) => unknown)(...args);
      const then = moves.afterNextListing;
      moves.afterNextListing = null;
      then?.();
      return listed;
    },
  };
});

describe('the end-to-end tests’ reader of Drashti’s log, as Drashti moves a file of it', () => {
  /** A moment of November 2026 in this computer's time zone. */
  const at = (day: number, hour: number, minute = 0, second = 0, ms = 0) =>
    new Date(2026, 10, day, hour, minute, second, ms).getTime();
  const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-e2e-log-move-'));

  it('finds a line written before midnight when the next line moves drashti.log to its day between the listing and the read', () => {
    const userData = fresh();
    let now = at(23, 23, 59, 59, 826);
    startLogFile(join(userData, 'logs'), { now: () => now });
    log.warn('placeholder line just before midnight');
    log.info('placeholder save said');
    // Listed while the 23rd is still drashti.log; then the first line of the 24th moves it to drashti-2026-11-23.log.
    moves.afterNextListing = () => {
      now = at(24, 0, 0, 0, 503);
      log.info('placeholder line just after midnight');
    };
    const lines = logLines(userData);
    expect(moves.afterNextListing).toBeNull();
    expect(lines.filter((line) => line.includes('placeholder line just before midnight'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('placeholder line just after midnight'))).toHaveLength(1);
    // A one-shot count (diagnostics.spec.ts's Diagnostics saved) never reads low.
    expect(lines.filter((line) => line.includes('placeholder save said'))).toHaveLength(1);
    expect(lines.findIndex((line) => line.includes('just before midnight'))).toBeLessThan(
      lines.findIndex((line) => line.includes('just after midnight')),
    );
    // The same for the whole text.
    now = at(24, 0, 0, 1);
    log.info('placeholder line a second later');
    moves.afterNextListing = () => {
      now = at(25, 0, 0, 0, 503);
      log.info('placeholder line of the 25th');
    };
    const text = logText(userData);
    expect(text.match(/placeholder line just before midnight/gu) ?? []).toHaveLength(1);
    expect(text.match(/placeholder line a second later/gu) ?? []).toHaveLength(1);
    expect(text.match(/placeholder line of the 25th/gu) ?? []).toHaveLength(1);
  });

  it('never gives a part of the log: files that move during every read, a few times over, are said, not read', () => {
    const userData = fresh();
    let now = at(10, 12);
    startLogFile(join(userData, 'logs'), { now: () => now });
    log.info('placeholder line of the 10th');
    // After every listing, another day's first line: drashti.log moves each time.
    let movedTimes = 0;
    const moveAgain = () => {
      movedTimes++;
      now += 24 * 60 * 60 * 1000;
      log.info('placeholder line of a later day');
      moves.afterNextListing = moveAgain;
    };
    moves.afterNextListing = moveAgain;
    try {
      expect(() => logLines(userData)).toThrow(/Drashti’s log moved a file during each of \d+ reads/u);
    } finally {
      moves.afterNextListing = null;
    }
    // Tried more than once, a few times at most.
    expect(movedTimes).toBeGreaterThan(2);
    expect(movedTimes).toBeLessThanOrEqual(12);
  });
});
