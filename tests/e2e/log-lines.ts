import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Drashti's log in a data folder, as the end-to-end tests read it (startup-reads.spec.ts): every file the log keeps
 * (main/log.ts, alpha.21: one file a day by the computer's own days), so a line written before the computer's midnight
 * is still found once the next line has moved drashti.log to drashti-YYYY-MM-DD.log (startup-reads.spec.ts:202,
 * flaky on CI Windows, 24 Nov 2026: a test that ran across 00:00 UTC read drashti.log alone and found none).
 * Placeholder lines only.
 */

/** An earlier day's file: its first part (drashti-YYYY-MM-DD.log) or a later one (drashti-YYYY-MM-DD.2.log...). */
const DATED = /^drashti-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/u;

/** A file's text; nothing when it has just moved to its day (the next read finds it there). */
function textOf(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') return '';
    throw error;
  }
}

/** The earlier days' files in `dir`, in the order written: the days oldest first, each day's parts in turn. */
function datedNames(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const m = DATED.exec(name);
      return m?.[1] ? [{ name, day: m[1], part: Number(m[2] ?? 1) }] : [];
    })
    .sort((a, b) => (a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1))
    .map((f) => f.name);
}

/** How many times the log is read while Drashti moves a file of it during the read, before that is said. */
const READS = 5;

/**
 * Every line Drashti has written to its log in `userData`, in the order written: each earlier day's files (the days
 * oldest first, each day's parts in turn), then today's drashti.log. Drashti moves drashti.log to its day at any
 * moment (log.ts), also during a read; a move always makes a new earlier file, so the files are listed again after
 * the read, and read again while that listing has changed. Never a part of the log: a log that moves during every
 * one of a few reads is said (an error), not read.
 */
export function logLines(userData: string): string[] {
  const dir = join(userData, 'logs');
  for (let read = 1; ; read++) {
    const listed = datedNames(dir);
    const lines = [...listed, 'drashti.log'].flatMap((name) => textOf(join(dir, name)).split('\n'));
    if (datedNames(dir).join('\n') === listed.join('\n')) return lines;
    if (read >= READS) throw new Error(`Drashti’s log moved a file during each of ${String(READS)} reads`);
  }
}

/**
 * The whole log in `userData` as one text, for a test that reads it whole (toContain, toMatch, a count): every file of
 * it in the order written, as logLines gives them (an empty line between one file and the next).
 */
export function logText(userData: string): string {
  return logLines(userData).join('\n');
}
