import { randomUUID } from 'node:crypto';
import type { ReadCaptionFile } from '../import/video-captions';
import type { WorkerProcess } from '../import/import-service';

/** Add a Caption File uses the existing low-priority import process, without opening a library connection. */
export class CaptionFileReader {
  private pending: { stop(): void } | null = null;
  private closed = false;
  constructor(private readonly spawn: () => WorkerProcess) {}

  read(file: string): Promise<ReadCaptionFile> {
    if (this.closed || this.pending)
      return Promise.resolve({
        track: null,
        problem: 'A caption file is already being read. Try again when it has finished.',
      });
    let worker: WorkerProcess;
    try {
      worker = this.spawn();
    } catch {
      return Promise.resolve({
        track: null,
        problem: 'The caption file could not be opened. Try adding it again.',
      });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ReadCaptionFile) => {
        if (settled) return;
        settled = true;
        this.pending = null;
        clearTimeout(timeout);
        worker.kill();
        resolve(result);
      };
      const failed = () =>
        finish({
          track: null,
          problem:
            'The caption file could not be read. The video can still play. Try adding the caption file again.',
        });
      const timeout = setTimeout(failed, 15_000);
      this.pending = { stop: failed };
      worker.onMessage((m) => {
        if (m.type === 'read-captions' && m.requestId === requestId) finish(m.result);
      });
      worker.onExit(failed);
      try {
        worker.postMessage({ type: 'read-captions', requestId, file });
      } catch {
        failed();
      }
    });
  }

  close(): void {
    this.closed = true;
    this.pending?.stop();
  }
}
