import { dirname } from 'node:path';
import { fetchToFile, lookAt } from './download';
import { type Get, LinkError, linkMessage } from './http';
import type { FromWorker, ToWorker } from './protocol';
import { unpackFolderZip } from './unzip';

/*
 * What the download process does with each message (Session 25b). Kept apart
 * from the process itself so the unit tests can run it with Node's fetch
 * against a local server; the process runs it with Electron's network stack.
 */

export interface WorkerDeps {
  get: Get;
  freeBytes(dir: string): number;
}

const failure = (error: unknown): FromWorker =>
  error instanceof LinkError
    ? { type: 'failed', code: error.code, message: error.message }
    : { type: 'failed', code: 'network', message: linkMessage('network') };

/** A handler for the main process's messages; `post` answers it. */
export function linkWorker(
  post: (message: FromWorker) => void,
  deps: WorkerDeps,
): (message: ToWorker) => void {
  let held = false;
  const stop = new AbortController();
  return (m) => {
    switch (m.type) {
      case 'hold':
        held = m.on;
        return;
      case 'stop':
        stop.abort();
        return;
      case 'look':
        lookAt(m.link, deps.get, { ...m.route, signal: stop.signal }).then(
          (looked) => {
            post({ type: 'looked', ...looked });
          },
          (error: unknown) => {
            post(failure(error));
          },
        );
        return;
      case 'download':
        fetchToFile(m.link, deps.get, {
          ...m.route,
          signal: stop.signal,
          part: m.part,
          held: () => held,
          freeBytes: () => deps.freeBytes(dirname(m.part)),
          keepFree: m.keepFree,
          maxBytes: m.maxBytes,
          progress: (done, total) => {
            post({ type: 'progress', done, total });
          },
        }).then(
          (got) => {
            post({ type: 'downloaded', ...got });
          },
          (error: unknown) => {
            post(failure(error));
          },
        );
        return;
      case 'unpack':
        void unpackFolderZip(m.zip, m.parent, m.name, {
          maxFiles: m.maxFiles,
          maxBytes: m.maxBytes,
          keepFree: m.keepFree,
          freeBytes: (dir) => deps.freeBytes(dir),
          signal: stop.signal,
          held: () => held,
          onWorkFolder: (path) => {
            post({ type: 'work-folder', path });
          },
        }).then((result) => {
          post(
            result.ok
              ? { type: 'unpacked', folder: result.folder, files: result.files, bytes: result.bytes }
              : { type: 'failed', code: 'unpack', message: result.message },
          );
        });
        return;
    }
  };
}
