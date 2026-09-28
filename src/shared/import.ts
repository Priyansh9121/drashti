/*
 * Importing files into the library (PLAN.md 4.4): the request the operator
 * makes, the progress they see, and the report kept afterwards.
 */

/** What to do with a file that was imported before and has changed since. */
export type ConflictChoice = 'replace' | 'keep-both' | 'skip';

export interface ImportOptions {
  /**
   * Changed files: 'ask' (the default) writes nothing for them and lists them
   * as conflicts, so the operator can choose; or one choice for all of them.
   */
  onConflict?: 'ask' | ConflictChoice;
  /** Choices for single files, by source path (the answers to an earlier run's conflicts). */
  decisions?: Record<string, ConflictChoice>;
}

/** How Drashti read a file. */
export type ImportFormat = 'text' | 'media' | 'pp6' | 'pp7' | 'unknown';

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
  | { kind: 'convert-font'; font: string };

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
  target: { kind: 'presentation' | 'media' | 'playlist'; id: string } | null;
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
