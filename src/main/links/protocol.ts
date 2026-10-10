import type { LinkErrorCode } from './http';

/*
 * Messages between the main process and the download process (Session 25b).
 * The download process makes every request and writes every byte; the main
 * process decides where files go, when to wait, and what is imported.
 */

/** Tests only: where requests go instead, and the guard that allows only 127.0.0.1. */
export interface WorkerRoute {
  testOrigin: string | null;
  guard: boolean;
}

export type ToWorker =
  | { type: 'look'; link: string; route: WorkerRoute }
  | { type: 'download'; link: string; part: string; keepFree: number; maxBytes: number; route: WorkerRoute }
  | {
      type: 'unpack';
      zip: string;
      parent: string;
      name: string;
      keepFree: number;
      maxFiles: number;
      maxBytes: number;
    }
  /** The stream went on air (or off): wait (or go on). */
  | { type: 'hold'; on: boolean }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'looked'; name: string | null; size: number | null; zip: boolean }
  | { type: 'progress'; done: number; total: number | null }
  | { type: 'downloaded'; name: string | null; zip: boolean; bytes: number }
  /** The hidden folder a zip is unpacked into first (cleared after a crash). */
  | { type: 'work-folder'; path: string }
  | { type: 'unpacked'; folder: string; files: string[]; bytes: number }
  | { type: 'failed'; code: LinkErrorCode | 'unpack'; message: string };
