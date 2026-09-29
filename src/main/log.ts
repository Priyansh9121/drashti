import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * The main process's log: to the console, and to a rotating file in the
 * data folder once startLogFile() has run (logs/drashti.log, then .1 to .4
 * as it fills). Log lines carry counts and ids, never library content: the
 * home folder is written as ~ and file URLs are left out, as a safety net
 * for a path in an error message.
 */

type Level = 'info' | 'warn' | 'error';

interface Sink {
  dir: string;
  maxBytes: number;
  keep: number;
  size: number;
}

let sink: Sink | null = null;
const HOME = homedir();
const FILE = 'drashti.log';

/** No paths in the log: the home folder becomes ~, and file URLs go. */
export function scrub(text: string): string {
  let out = HOME.length > 1 ? text.split(HOME).join('~') : text;
  out = out.replace(/file:\/\/[^\s"')]+/gu, 'file://…');
  return out;
}

function detailText(detail: unknown): string {
  if (detail === undefined) return '';
  if (detail instanceof Error)
    return ` ${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`;
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ' (a value that cannot be written)';
  }
}

const numbered = (dir: string, n: number) => join(dir, n === 0 ? FILE : `drashti.${n}.log`);

function rotate(s: Sink): void {
  rmSync(numbered(s.dir, s.keep - 1), { force: true });
  for (let n = s.keep - 2; n >= 0; n--) {
    const from = numbered(s.dir, n);
    if (existsSync(from)) renameSync(from, numbered(s.dir, n + 1));
  }
  s.size = 0;
}

function toFile(line: string): void {
  if (!sink) return;
  try {
    const bytes = Buffer.byteLength(line) + 1;
    if (sink.size + bytes > sink.maxBytes) rotate(sink);
    appendFileSync(numbered(sink.dir, 0), `${line}\n`);
    sink.size += bytes;
  } catch {
    // The log must never get in the way of the show.
  }
}

function write(level: Level, message: string, detail?: unknown): void {
  const line = scrub(`${new Date().toISOString()} [${level}] ${message}${detailText(detail)}`);
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(line);
  toFile(line);
}

/** Keep the log in files too, in `dir` (made if needed), about 2 MB each, the last 5. */
export function startLogFile(dir: string, options: { maxBytes?: number; keep?: number } = {}): void {
  mkdirSync(dir, { recursive: true });
  const current = numbered(dir, 0);
  sink = {
    dir,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    keep: Math.max(2, options.keep ?? 5),
    size: existsSync(current) ? statSync(current).size : 0,
  };
}

/** The log files, newest first (for diagnostics). */
export function logFiles(): string[] {
  const s = sink;
  if (!s) return [];
  return Array.from({ length: s.keep }, (_, n) => numbered(s.dir, n)).filter((f) => existsSync(f));
}

export const log = {
  info: (message: string, detail?: unknown) => {
    write('info', message, detail);
  },
  warn: (message: string, detail?: unknown) => {
    write('warn', message, detail);
  },
  error: (message: string, detail?: unknown) => {
    write('error', message, detail);
  },
};
