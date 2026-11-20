import type { CapturedPicture } from '../../shared/pdf-copy';
import type { ReportFileMeta } from '../../shared/report';
import type { Db } from '../db/database';
import type { DiagnosticsInput } from '../diagnostics';

/*
 * A report's files (x49), made in the report worker. (Not yet.)
 */

/** What Main gives for the diagnostics: Save Diagnostics' input but the library, which the worker opens itself. */
export type ReportDiagnosticsInput = Omit<DiagnosticsInput, 'db'>;

export interface ReportFilesJob {
  dir: string;
  stamp: string;
  diagnostics: { input: ReportDiagnosticsInput; dbFile: string } | null;
  picture: CapturedPicture | null;
  crash: { path: string; name: string; bytes: number }[];
}

export type ReportFilesMade =
  | { ok: true; files: ReportFileMeta[]; kept: { name: string; bytes: number }[]; errors: string[] }
  | { ok: false; message: string };

export interface ReportFilesDeps {
  openDb(file: string): Db;
  pace?: () => Promise<void>;
}

export function fitDiagnostics(text: string, _max: number): string {
  return text;
}

export function recentErrors(_text: string, _now: number): string[] {
  return [];
}

export function makeReportFiles(_job: ReportFilesJob, _deps: ReportFilesDeps): Promise<ReportFilesMade> {
  return Promise.resolve({ ok: false, message: 'Not yet.' });
}
