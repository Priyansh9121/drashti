import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { FromNetworkWorker, ToNetworkWorker } from './worker/protocol';
import { runNetworkWorker } from './worker/run';

/** The built worker sits next to the main bundle (see electron.vite.config.ts). */
export const networkWorkerPath = (): string => join(__dirname, 'network-worker.js');

export interface NetworkWorker {
  send(message: ToNetworkWorker): void;
  onMessage(listener: (message: FromNetworkWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

/** Start the network worker as an Electron utility process. */
export function spawnNetworkWorker(log: (line: string) => void): NetworkWorker {
  const child = utilityProcess.fork(networkWorkerPath(), [], {
    serviceName: 'Drashti network',
    stdio: 'pipe',
  });
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
        listener(message as FromNetworkWorker);
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

/**
 * The same worker in the main process itself. Drashti never runs it this
 * way: the performance check does (DRASHTI_PERF_NETWORK_IN_MAIN=1), to
 * measure what keeping the server out of the main process is worth.
 */
export function inProcessNetworkWorker(): NetworkWorker {
  const listeners: ((message: FromNetworkWorker) => void)[] = [];
  const handle = runNetworkWorker((message) => {
    // Delivered a turn later, as a port would.
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
    onExit: () => undefined,
    kill: () => undefined,
  };
}
