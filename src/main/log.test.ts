import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import type * as Fs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  log,
  logDays,
  logFiles,
  logFilesOf,
  onLogDaysChanged,
  scrub,
  setLogHeader,
  startLogCopy,
  startLogFile,
} from './log';

/*
 * A rename that fails, as on Windows while a scanner, the indexer or a log viewer holds the file (EBUSY, EPERM): the
 * real one otherwise. (alpha.21, a21-review: a failed move of drashti.log must never stop Drashti or lose a line.)
 */
const held = vi.hoisted(() => ({ on: false, tries: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof Fs>();
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      if (held.on) {
        held.tries++;
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: 'EBUSY' });
      }
      real.renameSync(from, to);
    },
  };
});

describe('the log file', () => {
  it('keeps the home folder and file URLs out of every line', () => {
    expect(scrub(`opened ${join(homedir(), 'Library', 'x.sqlite')}`)).toBe(
      `opened ${join('~', 'Library', 'x.sqlite')}`,
    );
    expect(scrub('from file:///Volumes/Old/Song.pro6 and more')).toBe('from file://… and more');
  });

  it('hides the key part of any RTMP address in every line, whatever wrote it (Session 28; the skills review MED-4)', () => {
    expect(scrub('push to rtmps://a.rtmp.youtube.com/live2/made-up-key-0000 failed')).toBe(
      'push to rtmps://a.rtmp.youtube.com/live2/[stream key] failed',
    );
    expect(scrub('rtmp://127.0.0.1:1935/live/placeholder_key-1')).toBe(
      'rtmp://127.0.0.1:1935/live/[stream key]',
    );
  });

  it('blanks any e-mail address, whatever wrote the line (alpha.21, logs (b): never a Gmail address in a log or a diagnostics file)', () => {
    expect(scrub('let in placeholder.person@gmail.com on placeholder-mac')).toBe(
      'let in [email] on placeholder-mac',
    );
    expect(scrub('Placeholder.Owner+drashti@Example.org, and more')).toBe('[email], and more');
    // Not an address: left as it is.
    expect(scrub('rtmp://127.0.0.1:1935/live and user@host')).toBe(
      'rtmp://127.0.0.1:1935/live and user@host',
    );
  });

  it('with a test’s copy, writes every line there too, whole and scrubbed, however the files rotate (alpha.21: a failed test keeps its Drashti’s log)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-log-'));
    const copy = join(mkdtempSync(join(tmpdir(), 'drashti-test-out-')), 'a', 'drashti-1.log');
    startLogFile(dir, { partBytes: 200 });
    startLogCopy(copy);
    for (let i = 0; i < 30; i++) log.info(`placeholder copy ${i} at ${join(homedir(), 'x')}`);
    const lines = readFileSync(copy, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(30);
    expect(lines[0]).toContain('placeholder copy 0 at ~');
    expect(lines[29]).toContain('placeholder copy 29');
    expect(readFileSync(copy, 'utf8')).not.toContain(homedir());
  });

  it('a copy that cannot be written never gets in the way: the log file goes on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-log-'));
    startLogFile(dir);
    // A folder where the file should be: every write to the copy fails.
    const copy = mkdtempSync(join(tmpdir(), 'drashti-test-out-'));
    startLogCopy(copy);
    expect(() => {
      log.warn('placeholder after a broken copy');
    }).not.toThrow();
    expect(readFileSync(join(dir, 'drashti.log'), 'utf8')).toContain('placeholder after a broken copy');
  });
});

/*
 * One file a day (alpha.21, the owner's "for all users there should be a log of everythiing as we expect more than
 * 100" and his "Yes, that plan"): today's lines in drashti.log, each earlier day's in drashti-YYYY-MM-DD.log (a day fuller
 * than a part goes on in drashti-YYYY-MM-DD.2.log, .3...), by this computer's own days; kept 30 days, and all of them
 * together at most a total size, the oldest going first. The clock here is the test's own.
 */
describe('the log, one file a day', () => {
  /** A moment of November 2026 in this computer's time zone. */
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-days-'));
  const names = (dir: string) => readdirSync(dir).sort();
  const text = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8');
  const age = (file: string, ms: number) => {
    utimesSync(file, ms / 1000, ms / 1000);
  };

  it("keeps each day's lines in their own file, by this computer's days: today's is drashti.log", () => {
    const dir = fresh();
    let now = at(23, 10);
    startLogFile(dir, { now: () => now });
    log.info('placeholder on the 23rd');
    now = at(23, 23, 59);
    log.info('placeholder just before midnight');
    now = at(24, 0, 0) + 1;
    log.info('placeholder just after midnight');
    expect(names(dir)).toEqual(['drashti-2026-11-23.log', 'drashti.log']);
    expect(text(dir, 'drashti-2026-11-23.log')).toContain('placeholder on the 23rd');
    expect(text(dir, 'drashti-2026-11-23.log')).toContain('placeholder just before midnight');
    expect(text(dir, 'drashti-2026-11-23.log')).not.toContain('after midnight');
    expect(text(dir, 'drashti.log')).toContain('placeholder just after midnight');
    expect(text(dir, 'drashti.log')).not.toContain('on the 23rd');
    expect(logDays()).toEqual(['2026-11-24', '2026-11-23']);
  });

  it('a start later the same day goes on in the same file; a start on a later day moves the last one to its own day', () => {
    const dir = fresh();
    let now = at(20, 9);
    startLogFile(dir, { now: () => now });
    log.info('placeholder first run');
    now = at(20, 18);
    startLogFile(dir, { now: () => now });
    log.info('placeholder second run, same day');
    expect(names(dir)).toEqual(['drashti.log']);
    expect(text(dir, 'drashti.log')).toContain('placeholder first run');
    // The file was last written on the 20th: started again on the 22nd, it becomes the 20th's.
    age(join(dir, 'drashti.log'), at(20, 18));
    now = at(22, 8);
    startLogFile(dir, { now: () => now });
    log.info('placeholder on the 22nd');
    expect(names(dir)).toEqual(['drashti-2026-11-20.log', 'drashti.log']);
    expect(text(dir, 'drashti-2026-11-20.log')).toContain('placeholder second run, same day');
    expect(text(dir, 'drashti.log')).toContain('placeholder on the 22nd');
    expect(logDays()).toEqual(['2026-11-22', '2026-11-20']);
  });

  it('a day fuller than a part goes on in a new part; the parts come back in the order they were written', () => {
    const dir = fresh();
    let now = at(23, 9);
    startLogFile(dir, { partBytes: 400, now: () => now });
    for (let i = 0; i < 30; i++) log.info(`placeholder part line ${String(i)}`);
    now = at(24, 9);
    log.info('placeholder next day');
    const day = names(dir).filter((n) => n.startsWith('drashti-2026-11-23'));
    expect(day.length).toBeGreaterThan(2);
    for (const n of day) expect(statSync(join(dir, n)).size).toBeLessThanOrEqual(400);
    const parts = logFilesOf(['2026-11-23']);
    expect(parts.map((f) => f.slice(dir.length + 1))).toEqual([
      'drashti-2026-11-23.log',
      ...day.filter((n) => n !== 'drashti-2026-11-23.log').sort((a, b) => partOf(a) - partOf(b)),
    ]);
    const lines = parts
      .map((f) => readFileSync(f, 'utf8'))
      .join('')
      .split('\n')
      .filter((l) => l.includes('placeholder part line'));
    expect(lines).toHaveLength(30);
    lines.forEach((l, i) => {
      expect(l).toContain(`placeholder part line ${String(i)}`);
    });
    // Today's own file is the newest part of today; asked for two days, the older day's come first.
    expect(logFilesOf(['2026-11-24', '2026-11-23']).at(-1)).toBe(join(dir, 'drashti.log'));
  });

  it("keeps 30 days: a day's files go once 30 days have begun since it", () => {
    const dir = fresh();
    for (let d = 1; d <= 22; d++)
      writeFileSync(join(dir, `drashti-2026-11-${String(d).padStart(2, '0')}.log`), 'placeholder\n');
    for (let d = 15; d <= 31; d++)
      writeFileSync(join(dir, `drashti-2026-10-${String(d)}.log`), 'placeholder\n');
    const now = at(23, 9);
    startLogFile(dir, { now: () => now });
    log.info('placeholder today');
    // Today (the 23rd) and the 29 days before it: from 25 October.
    expect(logDays().at(-1)).toBe('2026-10-25');
    expect(logDays()).toHaveLength(30);
    expect(names(dir)).not.toContain('drashti-2026-10-24.log');
    expect(names(dir)).toContain('drashti-2026-10-25.log');
  });

  it('keeps all the files together within the total size: the oldest go first, never the file being written', () => {
    const dir = fresh();
    for (let d = 10; d <= 22; d++)
      writeFileSync(join(dir, `drashti-2026-11-${String(d)}.log`), 'x'.repeat(1000));
    let now = at(23, 9);
    startLogFile(dir, { totalBytes: 5500, partBytes: 2000, now: () => now });
    log.info('placeholder today');
    const total = () => names(dir).reduce((sum, n) => sum + statSync(join(dir, n)).size, 0);
    expect(total()).toBeLessThanOrEqual(5500);
    expect(names(dir)).toContain('drashti-2026-11-22.log');
    expect(names(dir)).not.toContain('drashti-2026-11-17.log');
    // Today's file fills past the total by itself: the other days go, today's is kept.
    for (let i = 0; i < 200; i++) log.info(`placeholder busy ${String(i)}`);
    now = at(23, 10);
    log.info('placeholder still today');
    expect(total()).toBeLessThanOrEqual(5500 + 2000);
    expect(text(dir, 'drashti.log')).toContain('placeholder still today');
    expect(logDays()[0]).toBe('2026-11-23');
  });

  it('each new file begins with its header (who wrote it), and says so when its days change', () => {
    const dir = fresh();
    let now = at(23, 9);
    let changes = 0;
    startLogFile(dir, { now: () => now });
    const stop = onLogDaysChanged(() => {
      changes++;
    });
    setLogHeader(() => 'placeholder header: Drashti 1.0.0 on a placeholder computer');
    log.info('placeholder first');
    expect(text(dir, 'drashti.log').split('\n')[0]).toMatch(
      /^\S+ \[info\] Drashti’s log of 2026-11-23 .*placeholder header: Drashti 1\.0\.0 on a placeholder computer$/u,
    );
    const before = changes;
    now = at(24, 9);
    log.info('placeholder second day');
    expect(text(dir, 'drashti.log').split('\n')[0]).toContain('Drashti’s log of 2026-11-24');
    expect(changes).toBeGreaterThan(before);
    stop();
  });

  it("an earlier Drashti's numbered files (drashti.1.log...) become their days' parts, oldest first", () => {
    const dir = fresh();
    for (const [n, day, hour] of [
      [4, 18, 9],
      [3, 19, 9],
      [2, 21, 9],
      [1, 21, 15],
    ] as const) {
      const file = join(dir, `drashti.${String(n)}.log`);
      writeFileSync(file, `placeholder old ${String(n)}\n`);
      age(file, at(day, hour));
    }
    writeFileSync(join(dir, 'drashti.log'), 'placeholder old current\n');
    age(join(dir, 'drashti.log'), at(22, 20));
    const now = at(23, 9);
    startLogFile(dir, { now: () => now });
    log.info('placeholder new');
    expect(names(dir)).toEqual([
      'drashti-2026-11-18.log',
      'drashti-2026-11-19.log',
      'drashti-2026-11-21.2.log',
      'drashti-2026-11-21.log',
      'drashti-2026-11-22.log',
      'drashti.log',
    ]);
    expect(text(dir, 'drashti-2026-11-21.log')).toContain('placeholder old 2');
    expect(text(dir, 'drashti-2026-11-21.2.log')).toContain('placeholder old 1');
    expect(logFiles()[0]).toBe(join(dir, 'drashti.log'));
  });
});

/** A day's part number from its file's name (no number: the first). */
function partOf(name: string): number {
  return Number(/\.(\d+)\.log$/u.exec(name)?.[1] ?? 1);
}

describe('a file that cannot be moved (alpha.21, a21-review: Windows holds a file a scanner or viewer has open)', () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const fresh = () => mkdtempSync(join(tmpdir(), 'drashti-held-'));
  const text = (dir: string) => readFileSync(join(dir, 'drashti.log'), 'utf8');

  it('at a start on a later day, Drashti still starts, and the day goes on in drashti.log, said once in the log', () => {
    const dir = fresh();
    writeFileSync(
      join(dir, 'drashti.log'),
      `${new Date(at(20, 9)).toISOString()} [info] Drashti’s log of 2026-11-20 (this computer’s day; each line’s time is UTC)\nplaceholder line of the 20th\n`,
    );
    held.on = true;
    try {
      expect(() => {
        startLogFile(dir, { now: () => at(22, 8) });
      }).not.toThrow();
      log.info('placeholder first line of the 22nd');
      log.info('placeholder second line of the 22nd');
    } finally {
      held.on = false;
    }
    const all = text(dir);
    expect(all).toContain('placeholder line of the 20th');
    expect(all).toContain('placeholder first line of the 22nd');
    expect(all).toContain('placeholder second line of the 22nd');
    const said = all.split('\n').filter((l) => l.includes('could not be moved'));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^\S+ \[warn\] Log: .*could not be moved.*\(EBUSY\)/u);
    expect(readdirSync(dir)).toEqual(['drashti.log']);
  });

  it('a day fuller than a part, whose file cannot be moved, loses no line and is not tried again for every line', () => {
    const dir = fresh();
    startLogFile(dir, { partBytes: 300, now: () => at(23, 9) });
    log.info('placeholder before it is held');
    held.on = true;
    held.tries = 0;
    try {
      for (let i = 0; i < 20; i++) log.info(`placeholder held line ${String(i)}`);
    } finally {
      held.on = false;
    }
    const all = text(dir);
    for (let i = 0; i < 20; i++) expect(all).toContain(`placeholder held line ${String(i)}`);
    expect(held.tries).toBe(1);
    expect(all.split('\n').filter((l) => l.includes('could not be moved'))).toHaveLength(1);
  });

  it('at midnight, no line is lost and the move is not tried again for every line; the next start moves it', () => {
    const dir = fresh();
    let now = at(23, 22);
    startLogFile(dir, { now: () => now });
    log.info('placeholder on the 23rd');
    held.on = true;
    held.tries = 0;
    try {
      now = at(24, 0, 1);
      log.info('placeholder just after midnight');
      log.info('placeholder a little later');
      log.info('placeholder later still');
    } finally {
      held.on = false;
    }
    const all = text(dir);
    for (const words of [
      'placeholder on the 23rd',
      'placeholder just after midnight',
      'placeholder a little later',
      'placeholder later still',
    ])
      expect(all, words).toContain(words);
    expect(held.tries).toBe(1);
    expect(all.split('\n').filter((l) => l.includes('could not be moved'))).toHaveLength(1);
    // Free again: the next day's first line moves it as it should.
    now = at(25, 0, 1);
    log.info('placeholder on the 25th');
    expect(readdirSync(dir).sort()).toEqual(['drashti-2026-11-24.log', 'drashti.log']);
    expect(text(dir)).toContain('placeholder on the 25th');
  });
});
