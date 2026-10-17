import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  copyCrashFiles,
  crashFiles,
  crashFilesLines,
  KEEP_CRASH_FILES,
  keepNewestCrashFiles,
} from './crash-files';

/** A pretend crash folder as Crashpad keeps it: dumps under pending/ (Mac) or reports/ (Windows). */
function crashFolder(dumps: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-crashpad-'));
  mkdirSync(join(dir, 'pending'));
  mkdirSync(join(dir, 'reports'));
  writeFileSync(join(dir, 'settings.dat'), 'placeholder settings');
  for (let i = 0; i < dumps; i++) {
    const file = join(dir, i % 2 === 0 ? 'pending' : 'reports', `placeholder-${String(i)}.dmp`);
    writeFileSync(file, Buffer.alloc(1000 + i));
    // Each one a minute after the one before.
    const when = new Date(Date.UTC(2026, 9, 17, 18, i));
    utimesSync(file, when, when);
  }
  return dir;
}

describe('crash files (Sessions 31–36, ROB-6)', () => {
  it('finds the dumps wherever Crashpad put them, newest first, by name and size', () => {
    const dir = crashFolder(3);
    expect(crashFiles(dir).map((f) => [f.name, f.bytes])).toEqual([
      ['placeholder-2.dmp', 1002],
      ['placeholder-1.dmp', 1001],
      ['placeholder-0.dmp', 1000],
    ]);
    expect(crashFiles(join(dir, 'not there'))).toEqual([]);
  });

  it(`keeps the newest ${String(KEEP_CRASH_FILES)} and deletes the rest, nothing else`, () => {
    const dir = crashFolder(8);
    expect(keepNewestCrashFiles(dir)).toBe(3);
    expect(crashFiles(dir).map((f) => f.name)).toEqual([
      'placeholder-7.dmp',
      'placeholder-6.dmp',
      'placeholder-5.dmp',
      'placeholder-4.dmp',
      'placeholder-3.dmp',
    ]);
    expect(existsSync(join(dir, 'settings.dat'))).toBe(true);
    expect(keepNewestCrashFiles(dir)).toBe(0);
  });

  it('lists them for Diagnostics by name, size and time only, and says whether they are in', () => {
    const files = crashFiles(crashFolder(2));
    expect(crashFilesLines(files, false)).toEqual([
      'placeholder-1.dmp: 1001 bytes, written 2026-10-17T18:01:00.000Z',
      'placeholder-0.dmp: 1000 bytes, written 2026-10-17T18:00:00.000Z',
      'Not included: they can hold words from slides. Save Diagnostics again and tick Include crash files to add them.',
    ]);
    expect(crashFilesLines(files, true).at(-1)).toBe('Included: in the folder with this file.');
    expect(crashFilesLines([], false)).toEqual([]);
  });

  it('copies them into the folder Diagnostics makes', () => {
    const files = crashFiles(crashFolder(2));
    const into = mkdtempSync(join(tmpdir(), 'drashti-diagnostics-'));
    copyCrashFiles(files, into);
    expect(readdirSync(into).sort()).toEqual(['placeholder-0.dmp', 'placeholder-1.dmp']);
  });
});
