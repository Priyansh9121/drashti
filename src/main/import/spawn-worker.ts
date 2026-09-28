import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { log } from '../log';
import type { WorkerProcess } from './import-service';
import type { FromWorker, ToWorker } from './protocol';

/** The built worker sits next to the main bundle (see electron.vite.config.ts). */
export const importWorkerPath = (): string => join(__dirname, 'import-worker.js');

/** Start an import worker as an Electron utility process. */
export function spawnImportWorker(): WorkerProcess {
  const child = utilityProcess.fork(importWorkerPath(), [], { serviceName: 'Drashti import', stdio: 'pipe' });
  child.stdout?.on('data', (data: Buffer) => {
    log.info(`[import] ${data.toString().trimEnd()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    log.warn(`[import] ${data.toString().trimEnd()}`);
  });
  // Messages wait until the process is up.
  let spawned = false;
  const pending: ToWorker[] = [];
  child.once('spawn', () => {
    spawned = true;
    for (const message of pending.splice(0)) child.postMessage(message);
  });
  return {
    postMessage: (message) => {
      if (spawned) child.postMessage(message);
      else pending.push(message);
    },
    onMessage: (listener) => {
      child.on('message', (message: unknown) => {
        listener(message as FromWorker);
      });
    },
    onExit: (listener) => {
      child.on('exit', listener);
    },
    kill: () => {
      child.kill();
    },
  };
}
