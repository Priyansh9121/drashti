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

/**
 * Every line Drashti has written to its log in `userData`, in the order written: each earlier day's files (the days
 * oldest first, each day's parts in turn), then today's drashti.log.
 */
export function logLines(userData: string): string[] {
  const dir = join(userData, 'logs');
  const days = readdirSync(dir)
    .flatMap((name) => {
      const m = DATED.exec(name);
      return m?.[1] ? [{ name, day: m[1], part: Number(m[2] ?? 1) }] : [];
    })
    .sort((a, b) => (a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1));
  return [...days.map((f) => f.name), 'drashti.log'].flatMap((name) => textOf(join(dir, name)).split('\n'));
}

/**
 * The whole log in `userData` as one text, for a test that reads it whole (toContain, toMatch, a count): every file of
 * it in the order written, as logLines gives them.
 */
export function logText(userData: string): string {
  // Red: drashti.log alone, as the specs read it.
  return readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
}
