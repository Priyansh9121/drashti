import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { ReportFilesJob, ReportFilesMade } from './report-files';

/*
 * One report's files from the report worker (report-worker.ts, x49): a utility process started for the job and stopped
 * once it has answered (or after two minutes without an answer), so the files are made off Main's thread.
 */

/** The built worker sits beside the main bundle. */
const reportWorkerPath = (): string => join(__dirname, 'report-worker.js');

const NOT_MADE = 'The report’s files could not be made.';

export function runReportJob(job: ReportFilesJob, timeoutMs = 120_000): Promise<ReportFilesMade> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(reportWorkerPath(), [], {
      serviceName: 'Drashti report',
      stdio: 'ignore',
    });
    let done = false;
    const finish = (made: ReportFilesMade) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(made);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, message: NOT_MADE });
    }, timeoutMs);
    child.once('spawn', () => {
      child.postMessage(job);
    });
    child.on('message', (message: unknown) => {
      const made = message as ReportFilesMade | null;
      finish(made && typeof made === 'object' && 'ok' in made ? made : { ok: false, message: NOT_MADE });
    });
    child.once('exit', () => {
      finish({ ok: false, message: NOT_MADE });
    });
  });
}
