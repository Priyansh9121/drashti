import { Worker } from 'node:worker_threads';

/*
 * A file's sha256, read in a worker thread (Session 57): a long video never hashes on Electron's main thread, where
 * the operator's clicks and the show's commands wait. Trim's finished cuts and its unused-cuts sweep use it, and so do
 * media removal, the video copies, a model pack's re-check and (alpha.23, cap-packimport) a model pack's import.
 */

/** How often the worker tells how far it has read, when asked (a model pack's import shows it). */
const TELL_EVERY_BYTES = 8 * 1024 * 1024;

const HASH_WORKER = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { createReadStream } = require('node:fs');
  const { createHash } = require('node:crypto');
  const { file, every } = workerData;
  const hash = createHash('sha256');
  let bytes = 0;
  let told = 0;
  (async () => {
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
      bytes += chunk.length;
      if (every > 0 && bytes - told >= every) {
        told = bytes;
        parentPort.postMessage({ read: bytes });
      }
    }
    parentPort.postMessage({ sha256: hash.digest('hex'), bytes });
  })().catch((error) => { throw error; });
`;

export interface FileHash {
  sha256: string;
  bytes: number;
}

/**
 * The file's sha256 (hex) and length in bytes, read off Main's thread. `told`, when given, hears how many bytes have
 * been read, about every 8 MB. Rejects when `signal` aborts, once the worker has ended (its file closed): a result or
 * progress arriving after the abort is not taken.
 */
export function hashOffMain(
  file: string,
  signal?: AbortSignal,
  told?: (bytes: number) => void,
): Promise<FileHash> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(HASH_WORKER, {
      eval: true,
      workerData: { file, every: told ? TELL_EVERY_BYTES : 0 },
    });
    let over = false;
    const abort = () => {
      void worker.terminate();
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (found: FileHash | { read: number }) => {
      if (over || signal?.aborted) return;
      if ('sha256' in found) {
        over = true;
        resolve({ sha256: found.sha256, bytes: found.bytes });
      } else told?.(found.read);
    });
    worker.once('error', (error: Error) => {
      over = true;
      reject(error);
    });
    worker.once('exit', () => {
      over = true;
      signal?.removeEventListener('abort', abort);
      reject(new Error('The hash stopped before it finished.'));
    });
  });
}
