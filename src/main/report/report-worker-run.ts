import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type {
  DiagnosticsTextJob,
  DiagnosticsTextMade,
  NodeIntake,
  NodeIntakeJob,
  ReportFilesJob,
  ReportFilesMade,
} from './report-files';

/*
 * One report's files from the report worker (report-worker.ts, x49): a utility process started for the job and stopped
 * once it has answered (or after two minutes without an answer), so the files are made off Main's thread.
 */

/** The built worker sits beside the main bundle. */
const reportWorkerPath = (): string => join(__dirname, 'report-worker.js');

const NOT_MADE = 'The report’s files could not be made.';

export function runReportJob(job: ReportFilesJob, timeoutMs = 120_000): Promise<ReportFilesMade> {
  return inWorker<ReportFilesMade>(job, timeoutMs);
}

/** A node's report handed to Main (x49): read, checked and written in a report worker of its own. */
export function runReportIntake(job: NodeIntakeJob, timeoutMs = 60_000): Promise<NodeIntake> {
  return inWorker<NodeIntake>(job, timeoutMs);
}

/** Save Diagnostics' text (alpha.21, logs (c)), made in a report worker of its own, off Main's thread. */
export function runDiagnosticsText(
  job: DiagnosticsTextJob,
  timeoutMs = 120_000,
): Promise<DiagnosticsTextMade> {
  return inWorker<DiagnosticsTextMade>(job, timeoutMs, 'The diagnostics could not be made.');
}

function inWorker<T extends { ok: boolean }>(
  job: ReportFilesJob | NodeIntakeJob | DiagnosticsTextJob,
  timeoutMs: number,
  notMade = NOT_MADE,
): Promise<T> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(reportWorkerPath(), [], {
      serviceName: 'Drashti report',
      stdio: 'ignore',
    });
    let done = false;
    const finish = (made: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(made);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, message: notMade } as unknown as T);
    }, timeoutMs);
    child.once('spawn', () => {
      child.postMessage(job);
    });
    child.on('message', (message: unknown) => {
      const made = message as T | null;
      finish(
        made && typeof made === 'object' && 'ok' in made
          ? made
          : ({ ok: false, message: notMade } as unknown as T),
      );
    });
    child.once('exit', () => {
      finish({ ok: false, message: notMade } as unknown as T);
    });
  });
}
