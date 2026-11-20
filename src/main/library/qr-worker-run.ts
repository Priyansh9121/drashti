import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { QrJob, QrMade } from './qr-maker';

/*
 * One QR code's pictures from the QR worker (qr-worker.ts, Q60-28): a utility process started for the job and stopped
 * once it has answered (or after a minute without an answer), so the code is drawn, compressed and read back off
 * Main's thread.
 */

/** The built worker sits beside the main bundle. */
const qrWorkerPath = (): string => join(__dirname, 'qr-worker.js');

const TRY_AGAIN = 'The QR code could not be made: try again.';

/** Make a code's pictures in a QR worker of its own. */
export function runQrJob(job: QrJob, timeoutMs = 60_000): Promise<QrMade> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(qrWorkerPath(), [], {
      serviceName: 'Drashti QR code',
      stdio: 'ignore',
    });
    let done = false;
    const finish = (made: QrMade) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(made.ok ? { ...made, png: new Uint8Array(made.png) } : made);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, message: TRY_AGAIN });
    }, timeoutMs);
    child.once('spawn', () => {
      child.postMessage(job);
    });
    child.on('message', (message: unknown) => {
      const made = message as QrMade | null;
      finish(made && typeof made === 'object' && 'ok' in made ? made : { ok: false, message: TRY_AGAIN });
    });
    child.once('exit', () => {
      finish({ ok: false, message: TRY_AGAIN });
    });
  });
}
