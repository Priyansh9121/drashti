import { statfsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { RateGate } from '../rate-gate';
import { BackupStopped, pooledBackup } from './pooled';
import type { FromBackupWorker, ToBackupWorker } from './protocol';

/*
 * The backup worker: an Electron utility process started for each scheduled
 * backup, at the lowest priority and a limited speed, so copying the
 * library and its media never competes with the show. While the stream is
 * on air or recording the main process pauses it, and it waits.
 */

const port = process.parentPort;
try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not allowed on this system: run at normal priority (the speed limit still holds).
}

const post = (message: FromBackupWorker) => {
  port.postMessage(message);
};

let paused = false;
let cancelled = false;
let wake: (() => void) | null = null;
const resumeAll = () => {
  const w = wake;
  wake = null;
  w?.();
};

async function gate(): Promise<void> {
  while (paused && !cancelled)
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
}

port.on('message', (event: { data: ToBackupWorker }) => {
  const message = event.data;
  if (message.type === 'pause') paused = true;
  else if (message.type === 'resume') {
    paused = false;
    resumeAll();
  } else if (message.type === 'cancel') {
    cancelled = true;
    resumeAll();
  } else {
    void run(message);
  }
});

async function run(message: Extract<ToBackupWorker, { type: 'start' }>): Promise<void> {
  const rate = new RateGate(message.bytesPerSecond);
  let lastProgress = 0;
  try {
    const result = await pooledBackup(
      { ...message, now: new Date(message.now) },
      {
        gate,
        throttle: async (bytes) => {
          const wait = rate.take(bytes);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        },
        progress: (done, total) => {
          const now = Date.now();
          if (now - lastProgress < 250 && done < total) return;
          lastProgress = now;
          post({ type: 'progress', done, total });
        },
        cancelled: () => cancelled,
        freeBytes: (dir) => {
          const s = statfsSync(dir);
          return s.bavail * s.bsize;
        },
      },
    );
    post({ type: 'done', ...result });
  } catch (error) {
    // The code and a plain message only: an error's own text can hold a path.
    const code =
      error instanceof BackupStopped
        ? error.code
        : error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'error';
    const message =
      error instanceof BackupStopped
        ? error.message
        : code === 'ENOSPC'
          ? 'The backup drive is full: free some space on it, or choose another drive.'
          : code === 'EACCES' || code === 'EPERM'
            ? 'Drashti may not write to the backup folder: choose another folder, or ask the admin.'
            : code === 'ENOENT'
              ? 'The backup folder went away while it was being written (was the drive taken out?): connect it again, and back up again.'
              : 'The backup stopped. Back up again; if it stops again, choose Help, then Save Diagnostics…, and tell the admin.';
    post({ type: 'failed', code, message });
  }
}
