// What the disk holds around a test run (Session 54, after the gate of 28 Oct 2026, whose Mac started slowly from
// its 650th test on, with nothing in the log to say why): the free space on the temporary folder's disk, and how big
// the test runs' own temporary folders are (scripts/temp-root.mjs). CI says it before and after the end-to-end tests;
// tests/global-setup.ts says it for the run's own folder just before it goes.
//   node scripts/disk-note.mjs "<when>"
import { lstatSync, readdirSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** The bytes in a folder and everything in it (links not followed); what cannot be read counts nothing. */
export function folderBytes(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else
        try {
          total += lstatSync(p).size;
        } catch {
          // Gone meanwhile.
        }
    }
  }
  return total;
}

/**
 * One line: the free space on `dir`'s disk, and the size of `folders` (each test run's own, by default). It never
 * throws: what cannot be read is said, so neither a CI step nor the end of a test run fails on it.
 */
export function diskNote(when, dir = tmpdir(), folders = null) {
  try {
    let space = 'free space unknown';
    try {
      const s = statfsSync(dir);
      space = `${((s.bavail * s.bsize) / GB).toFixed(1)} GB free of ${((s.blocks * s.bsize) / GB).toFixed(1)} GB`;
    } catch {
      // A disk that does not say.
    }
    let runs = folders;
    if (runs === null) {
      try {
        runs = readdirSync(dir)
          .filter((n) => n.startsWith('drashti-run-'))
          .map((n) => join(dir, n));
      } catch {
        runs = [];
      }
    }
    const bytes = runs.reduce((sum, f) => sum + folderBytes(f), 0);
    return `Disk ${when}: ${space} where the temporary folders are (${dir}); the test runs' temporary folders: ${String(runs.length)}, ${(bytes / MB).toFixed(0)} MB.`;
  } catch (error) {
    return `Disk ${when}: not read (${error instanceof Error ? error.message : String(error)}).`;
  }
}

// Run as a script (tests/global-setup.ts imports it, through Playwright's loader, where import.meta is not there).
if (basename(process.argv[1] ?? '') === 'disk-note.mjs') {
  process.stdout.write(`${diskNote(process.argv[2] ?? 'now')}\n`);
}
