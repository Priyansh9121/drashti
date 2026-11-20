import { ACCESS_REPORT } from './access-protocol';

/*
 * Help › Report a Problem… (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42 on 20 Nov 2026): what a report is,
 * on both sides of the bridge. The access list's script makes the admin's email from the report (access-list/core.js);
 * Drashti's Review shows the same text before Send, made here by the same rules (src/shared/report.test.ts keeps the two
 * equal), so the person sees exactly what will be sent.
 */

export type ReportFrom = 'pro' | 'simple' | 'node';
export type ReportFileKind = 'diagnostics' | 'picture' | 'crash';

/** A computer as the email names it: its name, version and system. */
export interface ReportComputer {
  name: string;
  version: string;
  platform: string;
}

/** One feature of a report, with the person's own words. */
export interface ReportFeatureWords {
  chapter: string;
  name: string;
  what: string;
  expected?: string;
}

/** A file of a report as the call names it: its kind, name, type, size and SHA-256 (its bytes go apart, by the hash). */
export interface ReportFileMeta {
  kind: ReportFileKind;
  name: string;
  type: string;
  bytes: number;
  sha256: string;
}

/** The report as the access list is sent it: the call's `report` (its files' data goes after it, by SHA-256). */
export interface ReportCallReport {
  id: string;
  written: number;
  from: ReportFrom;
  node?: ReportComputer;
  features: ReportFeatureWords[];
  notice?: string;
  errors?: string[];
  files: ReportFileMeta[];
  kept?: { name: string; bytes: number }[];
}

/** What the admin's email is made of (access-list/core.js's reportMailText takes the same). */
export interface ReportMailParts {
  reference: string;
  gmail: string;
  computer: string;
  written: string;
  received: string;
  features: ReportFeatureWords[];
  notice?: string;
  errors?: string[];
  files: { name: string; bytes: number }[];
  kept?: { name: string; bytes: number }[];
  owner: boolean;
}

/** Each kind of file's media type, as the list takes it. */
export const REPORT_FILE_TYPES: Record<ReportFileKind, string> = {
  diagnostics: 'text/plain',
  picture: 'image/png',
  crash: 'application/octet-stream',
};

/** Drashti's own most for the picture and the diagnostics file; crash files go in what is left of the 7 MB. */
export const REPORT_PICTURE_BYTES = Math.floor(1.5 * 1024 * 1024);
export const REPORT_DIAGNOSTICS_BYTES = Math.floor(1.75 * 1024 * 1024);
/** What the Review says for the time the list will receive it. */
export const REPORT_RECEIVED_LATER = 'when it arrives';

/** The limits of a report's words and files (the list's: src/shared/access-protocol.ts). */
export const REPORT_LIMITS = ACCESS_REPORT;

export function reportReference(_id: string): string {
  return '';
}

export function reportCleanLines(_value: unknown): string {
  return '';
}

export function reportLetters(_text: string): number {
  return 0;
}

export function reportSubject(_names: readonly string[], _reference: string): string {
  return '';
}

export function reportComputerLine(
  _sender: ReportComputer,
  _from: ReportFrom,
  _node: ReportComputer | null,
): string {
  return '';
}

export function reportMailText(_parts: ReportMailParts): string {
  return '';
}

export function reportFileName(_kind: 'diagnostics' | 'picture', _stamp: string): string {
  return '';
}

/** What the person has written, as the window holds it. */
export interface ReportDraftWords {
  features: { name: string; what: string; expected: string }[];
}

export function draftProblem(_draft: ReportDraftWords): string | null {
  return null;
}
