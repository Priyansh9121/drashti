import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { LinkWorker } from './link-service';
import type { FromWorker, ToWorker } from './protocol';

/** The built download process sits next to the main bundle (see electron.vite.config.ts). */
export const downloadWorkerPath = (): string => join(__dirname, 'download-worker.js');

/**
 * Start a download process. Its output is not logged: Chromium's network
 * messages could name an address, and the log never keeps a link.
 */
export function spawnDownloadWorker(): LinkWorker {
  const child = utilityProcess.fork(downloadWorkerPath(), [], {
    serviceName: 'Drashti downloads',
    stdio: 'ignore',
  });
  let spawned = false;
  const pending: ToWorker[] = [];
  child.once('spawn', () => {
    spawned = true;
    for (const message of pending.splice(0)) child.postMessage(message);
  });
  return {
    post: (message) => {
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
