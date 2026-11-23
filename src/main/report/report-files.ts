import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapturedPicture } from '../../shared/pdf-copy';
import {
  readNodeReportBody,
  REPORT_DIAGNOSTICS_BYTES,
  REPORT_FILE_TYPES,
  REPORT_LIMITS,
  REPORT_PICTURE_BYTES,
  reportFileName,
  type ReportCallReport,
  type ReportFileKind,
  type ReportFileMeta,
} from '../../shared/report';
import { cutText } from '../../shared/text';
import type { Db } from '../db/database';
import {
  type DiagnosticsInput,
  diagnosticsText,
  libraryNames,
  type NodeDiagnosticsInput,
  nodeDiagnosticsText,
  redactNames,
} from '../diagnostics';
import { scrub } from '../log';
import { pngOf } from '../network/png';

/*
 * A report's files (x49, Help › Report a Problem…; the owner's Q60-38 and Q60-42), made in the report worker (a utility
 * process below normal priority, report-worker.ts), never on Main's thread: the diagnostics file, built exactly as Save
 * Diagnostics builds its own (diagnostics.ts: names in the library blanked, the log scrubbed), with its newest error
 * and warning lines for the email's text; the picture of the window, a PNG of at most 1,920 pixels a side (smaller
 * until it weighs at most REPORT_PICTURE_BYTES), made a slice at a time; the crash files, newest first and whole,
 * within what is left of the 7 MB (any left out named); and data.json, each file's base64 by its SHA-256, which the
 * call to the list carries after the signed part.
 */

/** What Main gives for the diagnostics: Save Diagnostics' input but the library, which the worker opens itself. */
export type ReportDiagnosticsInput = Omit<DiagnosticsInput, 'db'>;

export interface ReportFilesJob {
  /** The report's own folder (in the reports' folder); files/ and data.json are written in it. */
  dir: string;
  /** When it was made, as the files' names say it (fileStamp). */
  stamp: string;
  /** Ticked: Save Diagnostics' input, and the library's file (read only, for its counts and names). */
  diagnostics: { input: ReportDiagnosticsInput; dbFile: string } | null;
  /** Ticked on a node (x49, Q60-42 2): the node's own Save Diagnostics input (it has no library). */
  nodeDiagnostics?: NodeDiagnosticsInput | null;
  /** Ticked: the window's pixels, as captured. */
  picture: CapturedPicture | null;
  /** Ticked: the crash files kept, newest first. */
  crash: { path: string; name: string; bytes: number }[];
  /** The chosen period's time (alpha.21, logs (c)): the email's error lines are those within it (else the last day's). */
  errorsWithin?: { from: number; to: number };
}

export type ReportFilesMade =
  | {
      ok: true;
      files: ReportFileMeta[];
      /** Crash files left out, too large to send with the rest. */
      kept: { name: string; bytes: number }[];
      /** The diagnostics' newest error and warning lines, for the email's text. */
      errors: string[];
    }
  | { ok: false; message: string };

export interface ReportFilesDeps {
  /** The library, opened read only (the worker's better-sqlite3). */
  openDb(file: string): Db;
  /** Between the picture's slices: a moment for the show (the worker yields). */
  pace?: () => Promise<void>;
}

const DAY = 24 * 60 * 60_000;
/** A log line: its time, then its level. */
const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) \[(error|warn)\] /u;
const LOG_HEAD = '== Log ==\n';

/** The diagnostics text, at most `max` bytes: when larger, the log's oldest lines go first ("…" where they were). */
export function fitDiagnostics(text: string, max: number): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  const at = text.indexOf(LOG_HEAD);
  if (at < 0) return cutText(text, Math.floor(max / 4));
  const head = `${text.split(LOG_HEAD)[0] ?? ''}${LOG_HEAD}`;
  const lines = text.substring(at + LOG_HEAD.length).split('\n');
  let room = max - Buffer.byteLength(head, 'utf8') - Buffer.byteLength('…\n', 'utf8');
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    const bytes = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > room) break;
    room -= bytes;
    kept.unshift(line);
  }
  return `${head}…\n${kept.join('\n')}`;
}

/**
 * The newest error and warning lines of the diagnostics' log, each one cut to the list's limit: those within the
 * period's days (alpha.21, logs (c)), or with none given, the last day's.
 */
export function recentErrors(text: string, now: number, within?: { from: number; to: number }): string[] {
  const at = text.indexOf(LOG_HEAD);
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of text.substring(at + LOG_HEAD.length).split('\n')) {
    const m = LOG_LINE.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1] ?? '');
    if (!Number.isFinite(t)) continue;
    if (within ? t < within.from || t >= within.to : t < now - DAY || t > now + 60_000) continue;
    out.push(cutText(line.replace(/\s+/gu, ' ').trim(), REPORT_LIMITS.errorLetters, '…'));
  }
  return out.slice(-REPORT_LIMITS.errorLines);
}

/** Make a report's files in its folder, and data.json; what was made. */
export async function makeReportFiles(job: ReportFilesJob, deps: ReportFilesDeps): Promise<ReportFilesMade> {
  const filesDir = join(job.dir, 'files');
  mkdirSync(filesDir, { recursive: true });
  const made: { kind: ReportFileKind; name: string; bytes: Buffer }[] = [];
  let errors: string[] = [];
  if (job.nodeDiagnostics) {
    // As a node's Save Diagnostics writes its own file.
    const text = fitDiagnostics(scrub(nodeDiagnosticsText(job.nodeDiagnostics)), REPORT_DIAGNOSTICS_BYTES);
    errors = recentErrors(text, job.nodeDiagnostics.now.getTime(), job.errorsWithin);
    made.push({
      kind: 'diagnostics',
      name: reportFileName('diagnostics', job.stamp),
      bytes: Buffer.from(text, 'utf8'),
    });
  } else if (job.diagnostics) {
    const db = deps.openDb(job.diagnostics.dbFile);
    let text: string;
    try {
      const input: DiagnosticsInput = { ...job.diagnostics.input, db };
      text = scrub(redactNames(diagnosticsText(input), libraryNames(db)));
    } finally {
      db.close();
    }
    text = fitDiagnostics(text, REPORT_DIAGNOSTICS_BYTES);
    errors = recentErrors(text, job.diagnostics.input.now.getTime(), job.errorsWithin);
    made.push({
      kind: 'diagnostics',
      name: reportFileName('diagnostics', job.stamp),
      bytes: Buffer.from(text, 'utf8'),
    });
  }
  if (job.picture) {
    let longSide = 1920;
    let png = await pngOf(job.picture, deps.pace, longSide);
    while (png.length > REPORT_PICTURE_BYTES && longSide > 480) {
      longSide = Math.round(longSide * 0.75);
      png = await pngOf(job.picture, deps.pace, longSide);
    }
    if (png.length <= REPORT_PICTURE_BYTES)
      made.push({ kind: 'picture', name: reportFileName('picture', job.stamp), bytes: png });
  }
  const kept: { name: string; bytes: number }[] = [];
  let room = REPORT_LIMITS.filesBytes - made.reduce((sum, f) => sum + f.bytes.length, 0);
  let crashes = 0;
  for (const crash of job.crash) {
    let bytes: number;
    try {
      // Its size now (the one listed may be older).
      bytes = statSync(crash.path).size;
    } catch {
      continue;
    }
    if (bytes > room || crashes >= REPORT_LIMITS.crashFiles) {
      kept.push({ name: crash.name, bytes });
      continue;
    }
    made.push({ kind: 'crash', name: crash.name, bytes: readFileSync(crash.path) });
    room -= bytes;
    crashes++;
  }
  const files: ReportFileMeta[] = [];
  const data: Record<string, string> = {};
  for (const f of made) {
    writeFileSync(join(filesDir, f.name), f.bytes);
    const sha256 = createHash('sha256').update(f.bytes).digest('hex');
    data[sha256] = f.bytes.toString('base64');
    files.push({
      kind: f.kind,
      name: f.name,
      type: REPORT_FILE_TYPES[f.kind],
      bytes: f.bytes.length,
      sha256,
    });
  }
  writeFileSync(join(job.dir, 'data.json'), JSON.stringify(data), 'utf8');
  return { ok: true, files, kept, errors };
}

// ---- a node's report, handed to Main (x49, the owner's Q60-42, 2) ----

/** A node's report as Main is handed it, to read into the reports' folder. */
export interface NodeIntakeJob {
  dir: string;
  body: Uint8Array;
}

export type NodeIntake =
  | { ok: true; report: ReportCallReport; node: { version: string; platform: string } }
  | { ok: false; message: string };

const NOT_READ =
  'Main could not read that report: run the same Drashti on both computers, then send it again.';

/**
 * A node's report read and checked (each file against its data: the same bytes, size and SHA-256), and its files and
 * data.json written into its own folder in the reports' folder; once there, handed over again, it is not written again.
 * In the report worker, off Main's thread.
 */
export function intakeNodeReport(job: NodeIntakeJob): NodeIntake {
  const read = readNodeReportBody(job.body);
  if (read?.report.from !== 'node') return { ok: false, message: NOT_READ };
  const { report, data } = read;
  const folder = join(job.dir, report.id);
  if (existsSync(join(folder, 'report.json'))) return { ok: true, report, node: read.node };
  const wanted = new Set(report.files.map((f) => f.sha256));
  const keys = Object.keys(data);
  if (keys.length !== wanted.size || keys.some((k) => !wanted.has(k)))
    return { ok: false, message: NOT_READ };
  let total = 0;
  const files: { name: string; bytes: Buffer }[] = [];
  for (const f of report.files) {
    const base64 = data[f.sha256] ?? '';
    const bytes = Buffer.from(base64, 'base64');
    if (
      bytes.toString('base64') !== base64 ||
      bytes.length !== f.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== f.sha256
    )
      return { ok: false, message: NOT_READ };
    total += bytes.length;
    files.push({ name: f.name, bytes });
  }
  if (total > REPORT_LIMITS.filesBytes)
    return { ok: false, message: 'The report is too large: send it again without the crash files.' };
  mkdirSync(join(folder, 'files'), { recursive: true });
  for (const f of files) writeFileSync(join(folder, 'files', f.name), f.bytes);
  writeFileSync(join(folder, 'data.json'), JSON.stringify(data), 'utf8');
  return { ok: true, report, node: read.node };
}

// ---- Save Diagnostics' file, made in the report worker (alpha.21, logs (c)) ----

/** Save Diagnostics' text: Main's (with the library's file, read only) or a node's. */
export interface DiagnosticsTextJob {
  kind: 'diagnostics-text';
  main: { input: ReportDiagnosticsInput; dbFile: string } | null;
  node: NodeDiagnosticsInput | null;
}

export type DiagnosticsTextMade = { ok: true; text: string } | { ok: false; message: string };

/**
 * Save Diagnostics' text, made as a report's diagnostics are (in the report worker, off Main's thread: a chosen
 * period's log can be days long): Main's with every name in the library blanked, a node's as its own; scrubbed.
 */
export function makeDiagnosticsText(
  job: DiagnosticsTextJob,
  deps: Pick<ReportFilesDeps, 'openDb'>,
): DiagnosticsTextMade {
  if (job.node) return { ok: true, text: scrub(nodeDiagnosticsText(job.node)) };
  if (!job.main) return { ok: false, message: 'Nothing to make.' };
  const db = deps.openDb(job.main.dbFile);
  try {
    const input: DiagnosticsInput = { ...job.main.input, db };
    return { ok: true, text: scrub(redactNames(diagnosticsText(input), libraryNames(db))) };
  } finally {
    db.close();
  }
}
