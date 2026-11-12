/*
 * Importing files into the library (PLAN.md 4.4): the request the operator
 * makes, the progress they see, and the report kept afterwards.
 */

/** What to do with a file that was imported before and has changed since. */
export type ConflictChoice = 'replace' | 'keep-both' | 'skip';

export interface ImportOptions {
  /**
   * Changed files are kept beside the earlier import by default. Callers can set another policy.
   */
  onConflict?: 'ask' | ConflictChoice;
  /** Choices for single files, by source path (the answers to an earlier run's conflicts). */
  decisions?: Record<string, ConflictChoice>;
  /**
   * Simple Mode's import (Session 55, Part 18): only sounds, videos, pictures, PDFs and decks; every other file is left
   * out, saying why. Set by the main process alone while Simple Mode is on: a window's request never carries it
   * (import-schema.ts takes no such field).
   */
  simple?: true;
  /** Link imports and saved-link retries can request a smaller background copy of tall videos. */
  maxVideoHeight?: number;
}

/** How Drashti read a file. */
export type ImportFormat =
  | 'text'
  | 'media'
  | 'pp6'
  | 'pp7'
  | 'unknown'
  /** What an admin loads for the Shastra module, the calendar and the quotes (Session 12). */
  | 'shastra'
  | 'calendar'
  | 'quotes'
  /** PDF, PowerPoint and Keynote files, each page made a picture on its slide (Session 15). */
  | 'pictures';

export type ItemOutcome =
  /** New in the library. */
  | 'imported'
  /** An earlier import of the same file was updated in place. */
  | 'replaced'
  /** Imported next to an earlier import of the same file, under a new name. */
  | 'kept-both'
  /** Already in the library, unchanged (or skipped by choice). */
  | 'skipped'
  /** Changed since it was imported: waiting for the operator to choose. */
  | 'conflict'
  | 'failed'
  /** Not a format Drashti reads (yet). */
  | 'unsupported';

export type IssueSeverity = 'info' | 'warning' | 'error';

/** What the operator can do about an issue, from the report. */
export type IssueFix =
  | { kind: 'open-presentation'; presentationId: string }
  | { kind: 'relink-media'; mediaId: string }
  | { kind: 'choose'; sourcePath: string }
  | { kind: 'import-again'; sourcePath: string }
  | { kind: 'free-space'; neededBytes: number }
  | { kind: 'convert-font'; font: string }
  /** A background conversion of an imported file, optionally to fit a linked video's height limit. */
  | { kind: 'convert-media'; mediaId: string; advice: string; maxHeight?: number };

export interface ImportIssue {
  severity: IssueSeverity;
  /** Stable code, for example 'not-utf8', 'missing-media' or 'unsupported-element'. */
  code: string;
  message: string;
  fix: IssueFix | null;
}

export interface ImportCounts {
  presentations: number;
  groups: number;
  slides: number;
  arrangements: number;
  playlists: number;
  media: number;
}

export const NO_COUNTS: ImportCounts = {
  presentations: 0,
  groups: 0,
  slides: 0,
  arrangements: 0,
  playlists: 0,
  media: 0,
};

export interface ImportItemReport {
  id: string;
  sourcePath: string;
  format: ImportFormat;
  outcome: ItemOutcome;
  name: string | null;
  /** The library item it became, or the earlier import it matched. */
  target: {
    kind: 'presentation' | 'media' | 'playlist' | 'shastra' | 'calendar' | 'quotes';
    id: string;
  } | null;
  counts: ImportCounts;
  message: string | null;
  issues: ImportIssue[];
}

export type ImportRunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface ImportTotals extends ImportCounts {
  files: number;
  imported: number;
  replaced: number;
  keptBoth: number;
  skipped: number;
  conflicts: number;
  failed: number;
  unsupported: number;
  issues: number;
}

export interface ImportRunSummary {
  id: string;
  status: ImportRunStatus;
  startedAt: string;
  finishedAt: string | null;
  paths: string[];
  totals: ImportTotals;
  message: string | null;
}

export interface ImportReport extends ImportRunSummary {
  items: ImportItemReport[];
}

export interface RefusedImport {
  name: string;
  reason: string;
}

/** The operator's notices for an import by a watched folder, including files refused before the run. */
export type AutomaticImportNotice = { runId: string } | { refused: RefusedImport[] };

export interface ImportProgress {
  runId: string;
  phase: 'queued' | 'scanning' | 'importing' | 'finished';
  /** Files done and files found so far. */
  done: number;
  total: number;
  /** Name of the file being read. */
  current: string | null;
}

/** Where an import spent its time, in milliseconds (for diagnosing slow machines). */
export interface ImportTimings {
  scan: number;
  read: number;
  lookup: number;
  parse: number;
  /** Writing rows, and committing them (the part that waits for the disk). */
  write: number;
  commit: number;
  /** How many groups were committed (Session 16: commit / commits is a commit's time). */
  commits?: number;
  media: number;
  total: number;
}

export type ImportResult =
  { ok: true; run: ImportRunSummary; timings?: ImportTimings } | { ok: false; message: string };

export function emptyTotals(): ImportTotals {
  return {
    ...NO_COUNTS,
    files: 0,
    imported: 0,
    replaced: 0,
    keptBoth: 0,
    skipped: 0,
    conflicts: 0,
    failed: 0,
    unsupported: 0,
    issues: 0,
  };
}

/**
 * Whether an import brought a book in or updated one (alpha.15, the owner's answer of 4 Nov 2026): its passages in
 * playlists are there now, so the playlists are read again, as after a book is removed.
 */
export function loadedBooks(
  report: { items: readonly Pick<ImportItemReport, 'format' | 'outcome'>[] } | null,
): boolean {
  return (
    report?.items.some(
      (i) => i.format === 'shastra' && (i.outcome === 'imported' || i.outcome === 'replaced'),
    ) === true
  );
}
