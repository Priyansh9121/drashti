import type { ImportOptions, ImportProgress, ImportRunSummary } from '../../shared/import';

/* Messages between the main process and the import worker (a utility process). */

export interface StartMessage {
  type: 'start';
  /** Import files and folders, or relink missing media from a folder (paths[0]). */
  job: 'import' | 'relink';
  runId: string;
  paths: string[];
  options: ImportOptions;
  /** Relink: only these missing media items (default: all). */
  mediaIds?: string[];
  /** The library database (already migrated by the main process). */
  dbFile: string;
  mediaDir: string;
  /** Drashti's own data folder: never imported from. */
  userDataDir: string;
  /** The schema version the main process opened; the worker refuses any other. */
  schemaVersion: number;
}

export interface CancelMessage {
  type: 'cancel';
  runId: string;
}

export type ToWorker = StartMessage | CancelMessage;

export type FromWorker =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'wrote'; runId: string; presentationId: string; replaced: boolean }
  | { type: 'finished'; run: ImportRunSummary }
  | { type: 'failed'; runId: string; message: string };
