import Database from 'better-sqlite3';
import { constants, setPriority } from 'node:os';
import {
  type DiagnosticsTextJob,
  type DiagnosticsTextMade,
  intakeNodeReport,
  makeDiagnosticsText,
  makeReportFiles,
  type NodeIntake,
  type NodeIntakeJob,
  type ReportFilesJob,
  type ReportFilesMade,
} from './report-files';

/*
 * The report worker (x49, Help › Report a Problem…): an Electron utility process, started for one report's Review and
 * stopped once it has answered, that makes the report's files (report-files.ts) below normal priority, so neither
 * Main's thread nor the show's screens wait while the log is read, the library's names are blanked out of it, the
 * window's picture is compressed and the files are hashed. It opens the library read only. It prints nothing. Since
 * alpha.21 (logs (c)) it makes Save Diagnostics' text too, whose chosen period's log can be days long.
 */

const port = process.parentPort;

try {
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  // Not allowed on this system: run at normal priority.
}

/** Between the picture's slices: a turn for anything waiting. */
const yieldNow = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

const openReadOnly = (file: string) => new Database(file, { readonly: true, fileMustExist: true });

port.on('message', (event: { data: unknown }) => {
  // Save Diagnostics' text (alpha.21, logs (c)).
  if (
    event.data &&
    typeof event.data === 'object' &&
    (event.data as { kind?: unknown }).kind === 'diagnostics-text'
  ) {
    let made: DiagnosticsTextMade;
    try {
      made = makeDiagnosticsText(event.data as DiagnosticsTextJob, { openDb: openReadOnly });
    } catch (error) {
      made = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(made);
    return;
  }
  // A node's report handed to Main (x49): read, checked and written here, off Main's thread.
  if (event.data && typeof event.data === 'object' && 'body' in event.data) {
    let taken: NodeIntake;
    try {
      taken = intakeNodeReport(event.data as NodeIntakeJob);
    } catch (error) {
      taken = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(taken);
    return;
  }
  void (async () => {
    let made: ReportFilesMade;
    try {
      made = await makeReportFiles(event.data as ReportFilesJob, {
        openDb: openReadOnly,
        pace: yieldNow,
      });
    } catch (error) {
      made = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(made);
  })();
});
