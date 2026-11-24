import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logLines, logText } from '../../tests/e2e/log-lines';
import { log, startLogFile } from './log';

/*
 * The end-to-end tests' reader of Drashti's log (tests/e2e/log-lines.ts) reads every file the log keeps, as this
 * log.ts writes them across this computer's midnight: each earlier day's drashti-YYYY-MM-DD.log and its parts, then
 * today's drashti.log. startup-reads.spec.ts:202 was flaky on CI's Windows (24 Nov 2026, run 45288581430, whose
 * clock is UTC): Drashti wrote its line once at 23:59:59.826, the next line at 00:00:00.503 moved the file to its
 * day, and the spec, reading drashti.log alone, found none for its poll's whole 20 s. The clock here is the test's own.
 */
describe('the end-to-end tests’ reader of Drashti’s log', () => {
  /** A moment of November 2026 in this computer's time zone. */
  const at = (day: number, hour: number, minute = 0, second = 0, ms = 0) =>
    new Date(2026, 10, day, hour, minute, second, ms).getTime();
  const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-e2e-log-'));

  it('finds a line written just before midnight once the next line has moved it to its day, each line once', () => {
    const userData = fresh();
    let now = at(23, 23, 59, 59, 826);
    startLogFile(join(userData, 'logs'), { now: () => now });
    log.warn('placeholder line just before midnight');
    now = at(24, 0, 0, 0, 503);
    log.info('placeholder line just after midnight');
    // As the log keeps them: the 23rd in its own file, the 24th in drashti.log.
    expect(readdirSync(join(userData, 'logs')).sort()).toEqual(['drashti-2026-11-23.log', 'drashti.log']);
    const lines = logLines(userData);
    expect(lines.filter((line) => line.includes('placeholder line just before midnight'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('placeholder line just after midnight'))).toHaveLength(1);
  });

  it('gives the lines in the order written: the days oldest first, each day’s parts in turn, today’s last', () => {
    const userData = fresh();
    let now = at(22, 10);
    // Parts of about 300 bytes: the 23rd's lines go on in its later parts (drashti-2026-11-23.2.log...).
    startLogFile(join(userData, 'logs'), { now: () => now, partBytes: 300 });
    log.info('placeholder line 1 of the 22nd');
    now = at(23, 10);
    for (let i = 1; i <= 6; i++)
      log.info(`placeholder line ${String(i)} of the 23rd, long enough to fill a part`);
    now = at(24, 10);
    log.info('placeholder line 1 of the 24th');
    expect(
      readdirSync(join(userData, 'logs')).filter((name) => /^drashti-2026-11-23\.\d+\.log$/u.test(name))
        .length,
    ).toBeGreaterThan(0);
    const placeholders = logLines(userData)
      .map((line) => /placeholder line \d of the \d+\w\w/u.exec(line)?.[0])
      .filter((said) => said !== undefined);
    expect(placeholders).toEqual([
      'placeholder line 1 of the 22nd',
      ...[1, 2, 3, 4, 5, 6].map((i) => `placeholder line ${String(i)} of the 23rd`),
      'placeholder line 1 of the 24th',
    ]);
  });

  it('as one text: a line written just before midnight is still there once the next line has moved it to its day, once, and a count goes on across the day change', () => {
    const userData = fresh();
    let now = at(23, 23, 59, 58);
    startLogFile(join(userData, 'logs'), { now: () => now });
    log.info('placeholder check made');
    now = at(23, 23, 59, 59, 826);
    log.warn('placeholder line just before midnight');
    now = at(24, 0, 0, 0, 503);
    log.info('placeholder line just after midnight');
    log.info('placeholder check made');
    expect(readdirSync(join(userData, 'logs')).sort()).toEqual(['drashti-2026-11-23.log', 'drashti.log']);
    const text = logText(userData);
    expect(text.match(/placeholder line just before midnight/gu) ?? []).toHaveLength(1);
    expect(text.match(/placeholder line just after midnight/gu) ?? []).toHaveLength(1);
    expect(text.indexOf('placeholder line just before midnight')).toBeLessThan(
      text.indexOf('placeholder line just after midnight'),
    );
    // A count over the log (access-mode.spec's checks made, opening-timing.spec's openings ended) goes on from 1 to 2.
    expect(text.match(/placeholder check made/gu) ?? []).toHaveLength(2);
    // Each line whole, as the multi-line matches read it (diagnostics.spec.ts: ^…$ with the m flag).
    expect(text).toMatch(/^\S+ \[warn\] placeholder line just before midnight$/mu);
  });

  it('as one text: every file in the order written, the days oldest first, each day’s parts in turn, today’s last', () => {
    const userData = fresh();
    let now = at(22, 10);
    startLogFile(join(userData, 'logs'), { now: () => now, partBytes: 300 });
    log.info('placeholder line 1 of the 22nd');
    now = at(23, 10);
    for (let i = 1; i <= 6; i++)
      log.info(`placeholder line ${String(i)} of the 23rd, long enough to fill a part`);
    now = at(24, 10);
    log.info('placeholder line 1 of the 24th');
    expect(
      readdirSync(join(userData, 'logs')).filter((name) => /^drashti-2026-11-23\.\d+\.log$/u.test(name))
        .length,
    ).toBeGreaterThan(0);
    expect(logText(userData).match(/placeholder line \d of the \d+\w\w/gu) ?? []).toEqual([
      'placeholder line 1 of the 22nd',
      ...[1, 2, 3, 4, 5, 6].map((i) => `placeholder line ${String(i)} of the 23rd`),
      'placeholder line 1 of the 24th',
    ]);
    // The same lines as logLines gives, one after another.
    expect(logText(userData)).toBe(logLines(userData).join('\n'));
  });
});
