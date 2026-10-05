import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { FromLinkWorker, ToLinkWorker } from './worker/protocol';
import { runLinkWorker } from './worker/run';

/** The built worker sits next to the main bundle (see electron.vite.config.ts). */
export const linkWorkerPath = (): string => join(__dirname, 'link-worker.js');

export interface LinkWorker {
  send(message: ToLinkWorker): void;
  onMessage(listener: (message: FromLinkWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

/** Start the node link worker as an Electron utility process. */
export function spawnLinkWorker(log: (line: string) => void): LinkWorker {
  const child = utilityProcess.fork(linkWorkerPath(), [], { serviceName: 'Drashti nodes', stdio: 'pipe' });
  child.stdout?.on('data', (data: Buffer) => {
    log(data.toString().trimEnd());
  });
  child.stderr?.on('data', (data: Buffer) => {
    log(data.toString().trimEnd());
  });
  return {
    send: (message) => {
      child.postMessage(message);
    },
    onMessage: (listener) => {
      child.on('message', (message: unknown) => {
        listener(message as FromLinkWorker);
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

/** The same worker in the calling process (unit tests, and the performance check's comparison). */
export function inProcessLinkWorker(): LinkWorker {
  const listeners: ((message: FromLinkWorker) => void)[] = [];
  const exits: ((code: number) => void)[] = [];
  const handle = runLinkWorker((message) => {
    setImmediate(() => {
      for (const l of listeners) l(message);
    });
  });
  return {
    send: (message) => {
      handle(message);
    },
    onMessage: (listener) => {
      listeners.push(listener);
    },
    onExit: (listener) => {
      exits.push(listener);
    },
    kill: () => {
      handle({ type: 'stop' });
    },
  };
}
