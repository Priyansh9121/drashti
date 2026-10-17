import { copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatBytes } from '../shared/format';

/*
 * Crash files (Sessions 31–36, ROB-6). When any of Drashti's processes crashes, Chromium's crash reporter
 * writes a dump (a minidump) into the data folder's Crashpad folder, and never sends it anywhere
 * (crashReporter's uploadToServer is off). The newest five are kept; older ones are deleted at each start.
 * A dump holds the crashed process's memory, which can hold words from slides, so Save Diagnostics lists
 * the dumps by name, size and time only, and adds the files themselves only when the person saving ticks
 * Include crash files.
 */

/** How many dumps are kept, the newest. */
export const KEEP_CRASH_FILES = 5;

/** Said in the log and in Diagnostics when this run keeps no crash files (Drashti running translated). */
export const CRASH_FILES_NOT_KEPT =
  'Crash files are not kept while Drashti runs translated (an Intel build on an Apple-silicon Mac, or the x64 build on Windows on ARM)';

/**
 * Start the crash reporter, unless Drashti runs translated: then none, as alpha.5 started none anywhere. Under
 * Rosetta the crash reporter cannot read a translated process's threads ("thread_get_state … invalid
 * argument"), and when the watchdog restarted a window (Electron dumps the window first) the main process
 * stopped on SIGTRAP: the release check's Intel build, Release runs 39070516997 and 39071319781. The crash
 * journal still says what went wrong. Whether this run keeps crash files.
 */
export function startCrashReporter(
  translated: boolean,
  start: () => void,
  say: (line: string) => void,
): boolean {
  if (translated) {
    say(CRASH_FILES_NOT_KEPT);
    return false;
  }
  start();
  return true;
}

export interface CrashFile {
  path: string;
  name: string;
  bytes: number;
  at: Date;
}

/** The dumps under `dir` (Crashpad keeps them in pending/, completed/ or reports/), newest first. */
export function crashFiles(dir: string): CrashFile[] {
  const found: CrashFile[] = [];
  const walk = (folder: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(folder, name);
      try {
        const s = statSync(path);
        if (s.isDirectory() && depth < 3) walk(path, depth + 1);
        else if (s.isFile() && name.toLowerCase().endsWith('.dmp'))
          found.push({ path, name, bytes: s.size, at: s.mtime });
      } catch {
        // Gone meanwhile.
      }
    }
  };
  walk(dir, 0);
  return found.sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name));
}

/** Keep the newest `keep` dumps and delete the rest; how many were deleted. */
export function keepNewestCrashFiles(
  dir: string,
  keep = KEEP_CRASH_FILES,
  warn: (line: string) => void = () => undefined,
): number {
  let deleted = 0;
  for (const file of crashFiles(dir).slice(keep))
    try {
      rmSync(file.path, { force: true });
      deleted++;
    } catch (error) {
      warn(`An old crash file could not be deleted: ${String(error)}`);
    }
  return deleted;
}

/**
 * The dumps for Diagnostics' text: by name, size and time only, and whether they are in the folder; first,
 * when this run keeps none (`kept` false), why.
 */
export function crashFilesLines(files: readonly CrashFile[], included: boolean, kept = true): string[] {
  const why = kept ? [] : [CRASH_FILES_NOT_KEPT];
  if (files.length === 0) return why;
  return [
    ...why,
    ...files.map((f) => `${f.name}: ${formatBytes(f.bytes)}, written ${f.at.toISOString()}`),
    included
      ? 'Included: in the folder with this file.'
      : 'Not included: they can hold words from slides. Save Diagnostics again and tick Include crash files to add them.',
  ];
}

/** Copy the dumps into the folder Diagnostics makes. */
export function copyCrashFiles(files: readonly CrashFile[], into: string): void {
  for (const f of files) copyFileSync(f.path, join(into, f.name));
}
