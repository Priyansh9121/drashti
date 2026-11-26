import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instanceLines, logLines } from '../../tests/e2e/log-lines';
import { log, startLogFile } from './log';

/*
 * The end-to-end tests' reader of this start's lines in Drashti's log (tests/e2e/log-lines.ts, instanceLines): the
 * Drashti last started on a data folder, from its first line ("Start: the main process running at N ms") on, as this
 * log.ts writes them across this computer's midnight (CI's: 00:00 UTC), when the first line after it moves drashti.log
 * to its day. A start before it on the same data folder (a test that starts Drashti again) is not this start. The clock
 * is the test's own; each startLogFile here is a start of Drashti. Placeholder lines only.
 */
describe('the end-to-end tests’ reader of this start’s lines in Drashti’s log', () => {
  /** A moment of November 2026 in this computer's time zone. */
  const at = (day: number, hour: number, minute = 0, second = 0, ms = 0) =>
    new Date(2026, 10, day, hour, minute, second, ms).getTime();
  const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-e2e-log-instance-'));
  /** The placeholder lines among them, in order. */
  const placeholders = (lines: string[]) =>
    lines.map((line) => /placeholder line [\w ]+/u.exec(line)?.[0]).filter((said) => said !== undefined);

  it('this start began just before midnight: its lines of both days, from its first line on, never the earlier start’s', () => {
    const userData = fresh();
    const dir = join(userData, 'logs');
    let now = at(23, 22);
    startLogFile(dir, { now: () => now });
    log.info('Start: the main process running at 100 ms');
    log.warn('placeholder line of the earlier start');
    // Started again the same day, just before midnight: the same day's file goes on.
    now = at(23, 23, 59, 59, 800);
    startLogFile(dir, { now: () => now });
    log.info('Start: the main process running at 120 ms');
    now = at(23, 23, 59, 59, 826);
    log.warn('placeholder line just before midnight');
    now = at(24, 0, 0, 0, 503);
    log.info('placeholder line just after midnight');
    // As the log keeps them: both starts' lines of the 23rd in its own file, the 24th's in drashti.log.
    expect(readdirSync(dir).sort()).toEqual(['drashti-2026-11-23.log', 'drashti.log']);
    const lines = instanceLines(userData);
    expect(placeholders(lines)).toEqual([
      'placeholder line just before midnight',
      'placeholder line just after midnight',
    ]);
    expect(lines[0]).toMatch(/^\S+ \[info\] Start: the main process running at 120 ms$/u);
    // Every line of the log from this start's first line on, as logLines gives them (the 24th's header among them).
    const all = logLines(userData);
    expect(lines).toEqual(
      all.slice(all.findIndex((line) => line.endsWith('Start: the main process running at 120 ms'))),
    );
  });

  it('this start began after midnight: the start of the day before is not this start', () => {
    const userData = fresh();
    const dir = join(userData, 'logs');
    let now = at(23, 23, 30);
    startLogFile(dir, { now: () => now });
    log.info('Start: the main process running at 100 ms');
    log.warn('placeholder line of the start the day before');
    // Started again after midnight: the 23rd's file is moved to its day first.
    now = at(24, 0, 5);
    startLogFile(dir, { now: () => now });
    log.info('Start: the main process running at 90 ms');
    log.info('placeholder line of this start');
    expect(readdirSync(dir).sort()).toEqual(['drashti-2026-11-23.log', 'drashti.log']);
    const lines = instanceLines(userData);
    expect(placeholders(lines)).toEqual(['placeholder line of this start']);
    expect(lines[0]).toMatch(/^\S+ \[info\] Start: the main process running at 90 ms$/u);
  });

  it('before its first line, a start has no lines', () => {
    const userData = fresh();
    startLogFile(join(userData, 'logs'), { now: () => at(23, 10) });
    log.info('placeholder line before any start');
    expect(instanceLines(userData)).toEqual([]);
  });
});
