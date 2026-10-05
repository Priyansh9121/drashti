import type { PooledOptions, PooledResult } from './pooled';

/* Messages between the main process and the backup worker (a scheduled backup). */

export type ToBackupWorker =
  | ({ type: 'start'; now: string; bytesPerSecond: number } & Omit<PooledOptions, 'now'>)
  /** The stream went on air or started recording: wait; and when it is over, go on. */
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };

export type FromBackupWorker =
  | { type: 'progress'; done: number; total: number }
  | ({ type: 'done' } & PooledResult)
  | { type: 'failed'; code: string; message: string };
