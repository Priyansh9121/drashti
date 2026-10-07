import type { ImportOptions, ImportProgress, ImportRunSummary, ImportTimings } from '../../shared/import';
import type { PicturesResult } from '../../shared/pictures';

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
  /** Whether Keynote or PowerPoint may be asked to save files as PDF (tests can say no). */
  converters?: boolean;
}

export interface CancelMessage {
  type: 'cancel';
  runId: string;
}

/** A PDF drawn as pictures by the main process (the worker cannot open a window), for its request. */
export interface DrawnMessage {
  type: 'drawn';
  requestId: string;
  result: PicturesResult;
}

/**
 * The main process is about to write to the library (an operator's edit; Session 16): the import
 * gives way between files, answering 'gave-way' with its group committed, and waits for 'go-on'.
 */
export interface GiveWayMessage {
  type: 'give-way';
  id: string;
}

/** The main process has written: the import may carry on (for the 'gave-way' of this id). */
export interface GoOnMessage {
  type: 'go-on';
  id: string;
}

export type ToWorker = StartMessage | CancelMessage | DrawnMessage | GiveWayMessage | GoOnMessage;

export type FromWorker =
  | { type: 'progress'; progress: ImportProgress }
  /** Draw this PDF's pages as pictures into `outDir` (Session 15); the answer comes as 'drawn'. */
  | { type: 'draw-pdf'; requestId: string; pdf: string; outDir: string }
  | { type: 'wrote'; runId: string; presentationId: string; replaced: boolean }
  | { type: 'finished'; run: ImportRunSummary; timings?: ImportTimings }
  /** A line for Drashti's log (Keynote and PowerPoint's steps, Session 16). */
  | { type: 'log'; level: 'info' | 'warn'; message: string }
  /** Keynote or PowerPoint took the front with a message: Drashti's window should have it back. */
  | { type: 'refocus' }
  /** The library is free for the main process's write (`waiting`: the import waits for 'go-on'). */
  | { type: 'gave-way'; id: string; waiting: boolean }
  | { type: 'failed'; runId: string; message: string };
