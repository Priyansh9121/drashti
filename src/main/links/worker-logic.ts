import { dirname } from 'node:path';
import { fetchToFile, lookAt } from './download';
import { type Get, LinkError, linkMessage } from './http';
import type { FromWorker, ToWorker } from './protocol';
import { unpackFolderZip } from './unzip';
import { youtubeWorker } from './youtube-worker';

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
  // YouTube (Session 25c): yt-dlp, run from this process.
  const youtube = youtubeWorker(post, (dir) => deps.freeBytes(dir));
  let pendingLook: Extract<ToWorker, { type: 'look' }> | null = null;
  let looking: AbortController | null = null;
  const startLook = () => {
    const request = pendingLook;
    if (!request || held || stop.signal.aborted || looking) return;
    const controller = new AbortController();
    looking = controller;
    const abort = () => controller.abort();
    stop.signal.addEventListener('abort', abort, { once: true });
    void lookAt(request.link, deps.get, { ...request.route, signal: controller.signal })
      .then(
        (looked) => {
          if (controller.signal.aborted) return;
          pendingLook = null;
          post({ type: 'looked', ...looked });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          pendingLook = null;
          post(failure(error));
        },
      )
      .finally(() => {
        stop.signal.removeEventListener('abort', abort);
        looking = null;
        startLook();
      });
  };
  return (m) => {
    switch (m.type) {
      case 'hold':
        held = m.on;
        youtube.hold(m.on);
        if (m.on) looking?.abort();
        else startLook();
        return;
      case 'stop':
        stop.abort();
        youtube.stop();
        return;
      case 'yt-look':
        youtube.look(m);
        return;
      case 'yt-download':
        youtube.download(m);
        return;
      case 'look':
        pendingLook = m;
        startLook();
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
              : { type: 'failed', code: 'unpack', message: result.message, rule: result.rule },
          );
        });
        return;
    }
  };
}
