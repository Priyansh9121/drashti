import Database from 'better-sqlite3';
import { constants, setPriority } from 'node:os';
import { makeReportFiles, type ReportFilesJob, type ReportFilesMade } from './report-files';

/*
 * The report worker (x49, Help › Report a Problem…): an Electron utility process, started for one report's Review and
 * stopped once it has answered, that makes the report's files (report-files.ts) below normal priority, so neither
 * Main's thread nor the show's screens wait while the log is read, the library's names are blanked out of it, the
 * window's picture is compressed and the files are hashed. It opens the library read only. It prints nothing.
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

port.on('message', (event: { data: unknown }) => {
  void (async () => {
    let made: ReportFilesMade;
    try {
      made = await makeReportFiles(event.data as ReportFilesJob, {
        openDb: (file) => new Database(file, { readonly: true, fileMustExist: true }),
        pace: yieldNow,
      });
    } catch (error) {
      made = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(made);
  })();
});
