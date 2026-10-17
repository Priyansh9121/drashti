import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CrashJournal,
  childGoneWords,
  JOURNAL_ENTRIES,
  JOURNAL_FILE,
  JOURNAL_LETTERS,
  journalNotice,
  scrubEntry,
  watchdogWords,
} from './crash-journal';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 18, minute));
const fresh = () => join(mkdtempSync(join(tmpdir(), 'drashti-journal-')), JOURNAL_FILE);
// The time as the notice says it, fixed here (the computer's own time zone is not the test's business).
const hhmm = (iso: string) => iso.slice(11, 16);

describe('the crash journal (Sessions 31–36, ROB-6)', () => {
  it(`keeps the last ${String(JOURNAL_ENTRIES)} entries, in a file that survives Drashti`, () => {
    const file = fresh();
    const journal = new CrashJournal(file);
    for (let i = 0; i < JOURNAL_ENTRIES + 5; i++) journal.add(`placeholder problem ${String(i)}`, at(i));
    expect(journal.entries()).toHaveLength(JOURNAL_ENTRIES);
    expect(journal.entries()[0]?.what).toBe('placeholder problem 5');
    expect(journal.entries().at(-1)?.what).toBe(`placeholder problem ${String(JOURNAL_ENTRIES + 4)}`);
    // Read again, as the next start does.
    const again = new CrashJournal(file);
    expect(again.entries()).toEqual(journal.entries());
  });

  it('scrubs each entry as it is written: no home folder, no file address, no stream key, no long text', () => {
    const journal = new CrashJournal(fresh());
    journal.add(
      `Error: ENOENT ${join(homedir(), 'Placeholder Folder', 'placeholder.pro6')} at file:///Users/placeholder/out/main.js:12:3 sending rtmp://127.0.0.1/live/placeholder-made-up-key-0000`,
      at(1),
    );
    const what = journal.entries()[0]?.what ?? '';
    expect(what).not.toContain(homedir());
    expect(what).toContain('~');
    expect(what).not.toContain('file:///Users');
    expect(what).not.toContain('placeholder-made-up-key-0000');
    expect(what).toContain('[stream key]');
    // Cut to its length, on a letter: never half of a Gujarati or Hindi conjunct.
    const long = scrubEntry('ક્ષ'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(JOURNAL_LETTERS);
    expect(long.endsWith('…')).toBe(true);
    expect(long.slice(0, -1)).toBe('ક્ષ'.repeat((long.length - 1) / 3));
    // One line, whatever it was given.
    expect(scrubEntry('one\n  two\tthree')).toBe('one two three');
  });

  it('starts afresh from a file it cannot read, and never throws when it cannot write', () => {
    const file = fresh();
    writeFileSync(file, '{ cut short');
    const journal = new CrashJournal(file);
    expect(journal.entries()).toEqual([]);
    const warnings: string[] = [];
    const nowhere = new CrashJournal(join(file, 'not-a-folder', JOURNAL_FILE), (line) => warnings.push(line));
    expect(() => {
      nowhere.add('placeholder problem', at(2));
    }).not.toThrow();
    expect(warnings[0]).toMatch(/^The crash journal could not be written/u);
    // An entry that is not one Drashti writes is left out.
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        next: 3,
        shown: 0,
        entries: [
          { n: 1, at: at(3).toISOString(), what: 'kept' },
          { n: 2, what: 42 },
        ],
      }),
    );
    expect(new CrashJournal(file).entries().map((e) => e.what)).toEqual(['kept']);
  });

  it('gives what it noted since it was last shown, once', () => {
    const file = fresh();
    const journal = new CrashJournal(file);
    expect(journal.takeUnshown()).toEqual([]);
    journal.add('first placeholder problem', at(1));
    journal.add('second placeholder problem', at(2));
    expect(new CrashJournal(file).takeUnshown().map((e) => e.what)).toEqual([
      'first placeholder problem',
      'second placeholder problem',
    ]);
    const next = new CrashJournal(file);
    expect(next.takeUnshown()).toEqual([]);
    next.add('third placeholder problem', at(3));
    expect(new CrashJournal(file).takeUnshown().map((e) => e.what)).toEqual(['third placeholder problem']);
  });

  it('says at the next start what went wrong, the last problem first', () => {
    expect(journalNotice([], hhmm)).toBeNull();
    const one = [{ n: 1, at: at(41).toISOString(), what: 'the GPU process crashed (code 11)' }];
    expect(journalNotice(one, hhmm)).toBe(
      'While Drashti last ran, a problem was noted at 18:41: the GPU process crashed (code 11). Help, then Save Diagnostics…, keeps the details for the admin.',
    );
    const three = [
      { n: 1, at: at(30).toISOString(), what: 'output “Main Hall” crashed' },
      { n: 2, at: at(31).toISOString(), what: 'output “Main Hall” crashed' },
      ...one.map((e) => ({ ...e, n: 3 })),
    ];
    expect(journalNotice(three, hhmm)).toBe(
      'While Drashti last ran, 3 problems were noted; the last at 18:41: the GPU process crashed (code 11). Help, then Save Diagnostics…, keeps the details for the admin.',
    );
  });

  it('words the watchdog’s events and the processes that stopped', () => {
    expect(watchdogWords({ window: 'operator', kind: 'crashed', reason: 'killed' })).toBe(
      'the operator window crashed (killed); the watchdog brought it back',
    );
    expect(
      watchdogWords({ window: 'output "Main Hall"', kind: 'gave-up', reason: '6 crashes in a minute' }),
    ).toBe('output “Main Hall” kept crashing, so the watchdog stopped it (6 crashes in a minute)');
    expect(
      watchdogWords({
        window: 'audio player',
        kind: 'hung',
        reason: 'unresponsive for 5000 ms',
        stack: 'at placeholderLoop (output.js:1:2)',
      }),
    ).toBe(
      'the audio player hung (unresponsive for 5000 ms); its JavaScript: at placeholderLoop (output.js:1:2)',
    );
    // What the watchdog does as it should is no problem.
    expect(watchdogWords({ window: 'operator', kind: 'reloaded' })).toBeNull();
    expect(watchdogWords({ window: 'operator', kind: 'responsive' })).toBeNull();
    expect(childGoneWords({ type: 'GPU', reason: 'crashed', exitCode: 11 })).toBe(
      'the GPU process crashed (code 11)',
    );
    expect(childGoneWords({ type: 'Utility', reason: 'oom', exitCode: 0, name: 'Drashti network' })).toBe(
      'the utility process “Drashti network” ran out of memory',
    );
    // A process that ended as it should is no problem.
    expect(childGoneWords({ type: 'Utility', reason: 'clean-exit', exitCode: 0 })).toBeNull();
  });

  it('writes its file in the form it reads', () => {
    const file = fresh();
    new CrashJournal(file).add('placeholder problem', at(5));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      next: 2,
      shown: 0,
      entries: [{ n: 1, at: at(5).toISOString(), what: 'placeholder problem' }],
    });
  });
});
