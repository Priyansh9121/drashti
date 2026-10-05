import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { log } from '../log';
import type { FromBackupWorker, ToBackupWorker } from './protocol';

export interface BackupWorker {
  post(message: ToBackupWorker): void;
  onMessage(listener: (message: FromBackupWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

/** A backup worker as an Electron utility process (the built worker sits beside the main bundle). */
export function spawnBackupWorker(): BackupWorker {
  const child = utilityProcess.fork(join(__dirname, 'backup-worker.js'), [], {
    serviceName: 'Drashti backup',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (data: Buffer) => {
    log.info(`[backup] ${data.toString().trimEnd()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    log.warn(`[backup] ${data.toString().trimEnd()}`);
  });
  let spawned = false;
  const pending: ToBackupWorker[] = [];
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
        listener(message as FromBackupWorker);
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
