import { MessageChannelMain, type MessagePortMain, utilityProcess } from 'electron';
import { join } from 'node:path';
import type { FromVideoOutWorker, ToVideoOutWorker } from './protocol';

/** The built video-out process sits next to the main bundle (see electron.vite.config.ts). */
export const videoOutWorkerPath = (): string => join(__dirname, 'video-out-worker.js');

/** Its name among Drashti's processes (Activity Monitor, Task Manager, and the tests). */
export const VIDEO_OUT_SERVICE = 'Drashti video out';

export interface VideoOutWorker {
  send(message: ToVideoOutWorker): void;
  /** Hand over the port the stream's page sends its frames on. */
  sendFrames(port: MessagePortMain): void;
  onMessage(listener: (message: FromVideoOutWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

/** Start the video-out process as an Electron utility process. */
export function spawnVideoOutWorker(log: (line: string) => void): VideoOutWorker {
  const child = utilityProcess.fork(videoOutWorkerPath(), [], {
    serviceName: VIDEO_OUT_SERVICE,
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
    sendFrames: (port) => {
      child.postMessage({ type: 'frames' }, [port]);
    },
    onMessage: (listener) => {
      child.on('message', (message: unknown) => {
        listener(message as FromVideoOutWorker);
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

/** A new pair of ports: one for the video-out process, one for the stream's page. */
export function videoOutChannel(): { port1: MessagePortMain; port2: MessagePortMain } {
  return new MessageChannelMain();
}
