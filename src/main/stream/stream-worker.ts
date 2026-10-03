import { type MessagePortMain, utilityProcess } from 'electron';
import { join } from 'node:path';
import type { FromStreamWorker, ToStreamWorker } from './worker/protocol';

/** The built worker sits next to the main bundle (see electron.vite.config.ts). */
export const streamWorkerPath = (): string => join(__dirname, 'stream-worker.js');

export interface StreamWorker {
  send(message: ToStreamWorker): void;
  /** Hand over the port the stream's page sends frames and sound on. */
  sendFrames(port: MessagePortMain): void;
  onMessage(listener: (message: FromStreamWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

/** Start the stream worker as an Electron utility process. */
export function spawnStreamWorker(log: (line: string) => void): StreamWorker {
  const child = utilityProcess.fork(streamWorkerPath(), [], { serviceName: 'Drashti stream', stdio: 'pipe' });
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
    sendFrames: (port) => {
      child.postMessage({ type: 'frames' }, [port]);
    },
    onMessage: (listener) => {
      child.on('message', (message: unknown) => {
        listener(message as FromStreamWorker);
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
