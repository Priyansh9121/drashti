import { Worker } from 'node:worker_threads';

/*
 * A file's sha256, read in a worker thread (Session 57): a long video never hashes on Electron's main thread, where
 * the operator's clicks and the show's commands wait. Trim's finished cuts and its unused-cuts sweep use it.
 */

const HASH_WORKER = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { createReadStream } = require('node:fs');
  const { createHash } = require('node:crypto');
  const hash = createHash('sha256');
  let bytes = 0;
  (async () => {
    for await (const chunk of createReadStream(workerData)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    parentPort.postMessage({ sha256: hash.digest('hex'), bytes });
  })().catch((error) => { throw error; });
`;

export interface FileHash {
  sha256: string;
  bytes: number;
}

/** The file's sha256 (hex) and length in bytes, read off Main's thread. Rejects when `signal` aborts. */
export function hashOffMain(file: string, signal?: AbortSignal): Promise<FileHash> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(HASH_WORKER, { eval: true, workerData: file });
    const abort = () => {
      void worker.terminate();
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (found: FileHash) => {
      resolve({ sha256: found.sha256, bytes: found.bytes });
    });
    worker.once('error', reject);
    worker.once('exit', () => {
      signal?.removeEventListener('abort', abort);
      reject(new Error('The hash stopped before it finished.'));
    });
  });
}
