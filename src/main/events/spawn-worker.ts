import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { FromEventsWorker, ToEventsWorker } from './protocol';

/** The events worker as the service sees it (a stand-in in unit tests). */
export interface EventsWorker {
  post(message: ToEventsWorker): void;
  onMessage(listener: (message: FromEventsWorker) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

/** The built events process sits next to the main bundle (see electron.vite.config.ts). */
const eventsWorkerPath = (): string => join(__dirname, 'events-worker.js');

/** Start the events process. Its output is not logged: nothing about an address or a secret may be. */
export function spawnEventsWorker(): EventsWorker {
  const child = utilityProcess.fork(eventsWorkerPath(), [], {
    serviceName: 'Drashti events',
    stdio: 'ignore',
  });
  let spawned = false;
  const pending: ToEventsWorker[] = [];
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
        listener(message as FromEventsWorker);
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
