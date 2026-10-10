import { statfsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { electronGet } from './electron-get';
import type { ToWorker } from './protocol';
import { linkWorker } from './worker-logic';

/*
 * The download process (Session 25b): an Electron utility process started
 * for each look or download, at the lowest priority, as the import worker
 * is. Whenever the computer is busy, the show comes first. It prints nothing:
 * nothing about a link, a title or a file name reaches the log.
 */

const port = process.parentPort;

try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not allowed on this system: run at normal priority.
}

const freeBytes = (dir: string): number => {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
};

const handle = linkWorker(
  (message) => {
    port.postMessage(message);
  },
  { get: electronGet, freeBytes },
);

port.on('message', (event: { data: unknown }) => {
  handle(event.data as ToWorker);
});
