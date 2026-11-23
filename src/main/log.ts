import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { dayOf, nextDayStart } from '../shared/log-period';
import { redact } from './stream/redact';

/*
 * The main process's log: to the console, and to files in the data folder once startLogFile() has run (alpha.21, the
 * owner's "for all users there should be a log of everythiing as we expect more than 100, if someone has issue, i
 * should identify and troubleshoot based in logs", and his "Yes, that plan"): one file a day, by this computer's own
 * days. Today's lines go to logs/drashti.log; at the day's end (or at a start on a later day) it becomes
 * drashti-YYYY-MM-DD.log, its day's. A day fuller than a part goes on in a new part (drashti-YYYY-MM-DD.2.log, .3...).
 * The files are kept 30 days, and all of them together within a total size: past it, the oldest go first, never the
 * file being written. Each new file begins with a header saying who wrote it (setLogHeader). Log lines carry counts and
 * ids, never library content: the home folder is written as ~ and file URLs are left out, as a safety net for a path
 * in an error message. Tests can have every line written to one more file as well (startLogCopy).
 */

type Level = 'info' | 'warn' | 'error';

interface Sink {
  dir: string;
  partBytes: number;
  totalBytes: number;
  days: number;
  now: () => number;
  /** The day drashti.log holds, and when the next one begins (ms). */
  day: string;
  dayEnds: number;
  size: number;
  /** A move of drashti.log that failed, said in the log with the next line (once). */
  unmoved: string | null;
  /** A full part's move failed: the day goes on in drashti.log, not tried again until the next day. */
  holdParts: boolean;
}

let sink: Sink | null = null;
/** Tests only (index.ts: never a packaged Drashti): one more file every line goes to, never rotated. */
let copy: string | null = null;
/** Who writes the log, for each new file's first line. */
let header: (() => string) | null = null;
const daysListeners = new Set<() => void>();
const HOME = homedir();
const FILE = 'drashti.log';
/** A day's file (its first part), or a later part of it. */
const DATED = /^drashti-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/u;
/** An earlier Drashti's numbered files (up to alpha.20: drashti.1.log to drashti.4.log, oldest last). */
const NUMBERED = /^drashti\.(\d+)\.log$/u;

/** At most this much in one file of a day: about 10 MB. */
export const LOG_PART_BYTES = 10 * 1024 * 1024;
/** All the log's files together at most: about 100 MB. */
export const LOG_TOTAL_BYTES = 100 * 1024 * 1024;
/** The days kept: today and the 29 before it. */
export const LOG_DAYS = 30;

/** An e-mail address (a Gmail let in, say): never in a log or a diagnostics file (alpha.21, logs (b)). */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu;

/** No paths in the log: the home folder becomes ~, and file URLs go; nor any e-mail address. */
export function scrub(text: string): string {
  let out = HOME.length > 1 ? text.split(HOME).join('~') : text;
  out = out.replace(/file:\/\/[^\s"')]+/gu, 'file://…');
  out = out.replace(EMAIL, '[email]');
  // The key part of any RTMP address, whatever wrote the line (Session 28; the skills review's MED-4).
  return redact(out);
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

const datedName = (day: string, part: number) =>
  part <= 1 ? `drashti-${day}.log` : `drashti-${day}.${String(part)}.log`;

/** A kept file of an earlier day: its day and part, or null for any other file. */
function datedOf(name: string): { day: string; part: number } | null {
  const m = DATED.exec(name);
  return m?.[1] ? { day: m[1], part: Number(m[2] ?? 1) } : null;
}

/** The earlier days' files in the folder, oldest first (by day, then part). */
function datedFiles(dir: string): { name: string; day: string; part: number }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => {
      const d = datedOf(name);
      return d ? [{ name, ...d }] : [];
    })
    .sort((a, b) => (a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1));
}

/** Move a finished file to its day's next part (after any part of that day already kept). */
function moveToDay(dir: string, from: string, day: string): void {
  const last = datedFiles(dir)
    .filter((f) => f.day === day)
    .reduce((n, f) => Math.max(n, f.part), 0);
  renameSync(join(dir, from), join(dir, datedName(day, last + 1)));
}

/** Each file's first line names its day (headerLine). */
const HEADER_DAY = /^\S+ \[info\] Drashti’s log of (\d{4}-\d{2}-\d{2}) /u;

/** The day a file holds: as its first line names it, else (an earlier Drashti's) by when it was last written. */
function fileDay(file: string): string {
  try {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(200);
      const n = readSync(fd, head, 0, head.length, 0);
      const named = HEADER_DAY.exec(head.subarray(0, n).toString('utf8'))?.[1];
      if (named) return named;
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unreadable: by its time.
  }
  return dayOf(statSync(file).mtimeMs);
}

/** Days before the first kept: today and the days - 1 before it stay. */
function firstKeptDay(s: Sink): string {
  const today = new Date(s.now());
  return dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (s.days - 1)).getTime());
}

/** Old days removed, then the oldest files while all of them weigh more than the total. Never drashti.log. */
function prune(s: Sink): void {
  const first = firstKeptDay(s);
  let files = datedFiles(s.dir).map((f) => {
    let bytes = 0;
    try {
      bytes = statSync(join(s.dir, f.name)).size;
    } catch {
      // Gone meanwhile.
    }
    return { ...f, bytes };
  });
  for (const f of files.filter((x) => x.day < first)) rmSync(join(s.dir, f.name), { force: true });
  files = files.filter((x) => x.day >= first);
  let total = s.size + files.reduce((sum, f) => sum + f.bytes, 0);
  for (const f of files) {
    if (total <= s.totalBytes) break;
    rmSync(join(s.dir, f.name), { force: true });
    total -= f.bytes;
  }
}

function daysChanged(): void {
  for (const listener of daysListeners) {
    try {
      listener();
    } catch {
      // A listener's fault is never the log's.
    }
  }
}

/** The line that begins a new file: its day, and who writes it. */
function headerLine(s: Sink): string {
  let who: string;
  try {
    who = header ? `: ${header()}` : '';
  } catch {
    who = ': (who writes it could not be said)';
  }
  return scrub(
    `${new Date(s.now()).toISOString()} [info] Drashti’s log of ${s.day} (this computer’s day; each line’s time is UTC)${who}`,
  );
}

/** Why a move failed, by its code only (EBUSY, EPERM…). */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'an error';
}

/** The line that says drashti.log could not be moved (on Windows, a scanner or a viewer holding it). */
const unmovedLine = (day: string, error: unknown) =>
  `Log: drashti.log could not be moved to its day, ${day} (${codeOf(error)}): its lines and the next go on in it until it can be`;

/**
 * drashti.log moved to its day's part, and a new one begun for `day`. A move that fails (Windows: a file another
 * program holds) loses nothing: the lines go on in drashti.log, the new day is taken anyway (so the move is not tried
 * for every line), and the log says so once; the next new day, or the next start, moves it.
 */
function nextFile(s: Sink, day: string): void {
  const current = join(s.dir, FILE);
  let moved = true;
  if (existsSync(current))
    try {
      moveToDay(s.dir, FILE, s.day);
    } catch (error) {
      moved = false;
      s.unmoved = unmovedLine(s.day, error);
    }
  // A full part not moved waits for the next day (or start); a new day tries again.
  s.holdParts = !moved && day === s.day;
  s.day = day;
  s.dayEnds = nextDayStart(s.now());
  if (moved) s.size = 0;
  try {
    prune(s);
  } catch {
    // Never in the way.
  }
  daysChanged();
}

function toFile(line: string): void {
  const s = sink;
  if (!s) return;
  try {
    const now = s.now();
    const bytes = Buffer.byteLength(line) + 1;
    if (now >= s.dayEnds) nextFile(s, dayOf(now));
    else if (!s.holdParts && s.size > 0 && s.size + bytes > s.partBytes) nextFile(s, s.day);
    if (s.size === 0) {
      const head = headerLine(s);
      const first = `${head}\n`;
      appendFileSync(join(s.dir, FILE), first);
      s.size += Buffer.byteLength(first);
    }
    if (s.unmoved !== null) {
      const said = `${scrub(`${new Date(now).toISOString()} [warn] ${s.unmoved}`)}\n`;
      s.unmoved = null;
      appendFileSync(join(s.dir, FILE), said);
      s.size += Buffer.byteLength(said);
    }
    appendFileSync(join(s.dir, FILE), `${line}\n`);
    s.size += bytes;
  } catch {
    // The log must never get in the way of the show.
  }
}

function toCopy(line: string): void {
  if (copy === null) return;
  try {
    appendFileSync(copy, `${line}\n`);
  } catch {
    // Nor may a test's copy.
  }
}

function write(level: Level, message: string, detail?: unknown): void {
  const line = scrub(`${new Date().toISOString()} [${level}] ${message}${detailText(detail)}`);
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(line);
  toFile(line);
  toCopy(line);
}

/** An earlier Drashti's numbered files, oldest first (the highest number), each moved to its day's next part. */
function moveNumbered(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const numbered = names
    .flatMap((name) => {
      const m = NUMBERED.exec(name);
      return m?.[1] ? [{ name, n: Number(m[1]) }] : [];
    })
    .sort((a, b) => b.n - a.n);
  for (const f of numbered) {
    try {
      moveToDay(dir, f.name, fileDay(join(dir, f.name)));
    } catch {
      // Left as it was: never in the way.
    }
  }
}

/**
 * Keep the log in files too, in `dir` (made if needed): one a day, LOG_PART_BYTES each at most, LOG_DAYS days and
 * LOG_TOTAL_BYTES in all (the options: tests only). A file from an earlier day (by when it was last written) is moved
 * to its day first; so are an earlier Drashti's numbered files.
 */
export function startLogFile(
  dir: string,
  options: { partBytes?: number; totalBytes?: number; days?: number; now?: () => number } = {},
): void {
  mkdirSync(dir, { recursive: true });
  const now = options.now ?? Date.now;
  const current = join(dir, FILE);
  // Lines from before (an earlier Drashti's numbered files, then the last file) go first, in their order.
  moveNumbered(dir);
  const today = dayOf(now());
  let size = 0;
  let unmoved: string | null = null;
  // Never in the way of the start (this runs before anything else): a file that cannot be moved (Windows: a scanner
  // or a viewer holding it) stays drashti.log, today's lines go on in it, and the log says so once.
  try {
    if (existsSync(current)) {
      const was = fileDay(current);
      if (was === today) size = statSync(current).size;
      else
        try {
          moveToDay(dir, FILE, was);
        } catch (error) {
          unmoved = unmovedLine(was, error);
          size = statSync(current).size;
        }
    }
  } catch {
    // Unreadable: written to as it is.
  }
  sink = {
    dir,
    partBytes: options.partBytes ?? LOG_PART_BYTES,
    totalBytes: options.totalBytes ?? LOG_TOTAL_BYTES,
    days: Math.max(1, options.days ?? LOG_DAYS),
    now,
    day: today,
    dayEnds: nextDayStart(now()),
    size,
    unmoved,
    holdParts: false,
  };
  try {
    prune(sink);
  } catch {
    // Never in the way.
  }
  daysChanged();
}

/** Each new file's first line says who writes the log (index.ts: the version, the system, this computer). */
export function setLogHeader(who: (() => string) | null): void {
  header = who;
}

/** Told whenever the days kept change (a new day, a day removed): Help's menu lists them. */
export function onLogDaysChanged(listener: () => void): () => void {
  daysListeners.add(listener);
  return () => {
    daysListeners.delete(listener);
  };
}

/**
 * Tests only: every line from now on written to `file` too (its folder made if needed), as the log file has it
 * (alpha.21, the owner's Q60-57: the test's own folder, kept only when the test fails, so a failed test keeps its
 * Drashti's log).
 */
export function startLogCopy(file: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    copy = file;
  } catch {
    copy = null;
  }
}

/** The days the log holds (YYYY-MM-DD, this computer's days), newest first. */
export function logDays(): string[] {
  const s = sink;
  if (!s) return [];
  const days = new Set(datedFiles(s.dir).map((f) => f.day));
  if (existsSync(join(s.dir, FILE))) days.add(s.day);
  return [...days].sort().reverse();
}

/** The files of these days, oldest first (each day's parts in the order written; today's drashti.log last). */
export function logFilesOf(days: readonly string[]): string[] {
  const s = sink;
  if (!s) return [];
  const wanted = new Set(days);
  const files = datedFiles(s.dir)
    .filter((f) => wanted.has(f.day))
    .map((f) => join(s.dir, f.name));
  const current = join(s.dir, FILE);
  if (wanted.has(s.day) && existsSync(current)) files.push(current);
  return files;
}

/** Every file the log holds, newest first. */
export function logFiles(): string[] {
  return logFilesOf(logDays()).reverse();
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
