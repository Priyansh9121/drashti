import type { IpcMainInvokeEvent } from 'electron';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import type { ClipExportRequest } from '../../shared/video-copies';
import type { Db } from '../db/database';
import type { MediaRepo } from '../db/media';
import { handle } from '../ipc/handle';
import { AFTER_START_MS, type ConvertService } from './convert-service';
import { ClipExports, type ExportSourceResult } from './clip-export-service';
import { CombineVideos } from './combine-service';
import { ProxyService } from './proxy-service';
import { copyRequests, discardUnlisted, registerProxyFile, unlistedMadeFrom } from './video-copy-files';

export interface VideoCopyIpcDeps {
  db: Db;
  media: MediaRepo;
  mediaDir: string;
  conversions: ConvertService;
  fromOperator(event: IpcMainInvokeEvent): boolean;
  proMode(): boolean;
  idle(): boolean;
  /** An export the operator asked for may go on (alpha.22: nothing playing, off air, not recording); idle when left out. */
  saveIdle?(): boolean;
  gpuStatus(): unknown;
  freeBytes(dir: string): number;
  pickDest(name: string, container: 'mp4' | 'webm'): Promise<string | null>;
  showFile(path: string): void;
  libraryChanged(): void;
  /** S1 provides canonical identity; S2 supplies its actual pure original-quality export planner. */
  sourceId?: (mediaId: string) => string;
  editedExport?: (request: ClipExportRequest) => ExportSourceResult;
  /**
   * Combine videos…' Also save a copy to a file: Export…'s save dialog (the operator window, Downloads at `name`): the
   * file chosen, or null when closed (a22-review-combine S2: one dialog for both).
   */
  exportDialog?(name: string): Promise<string | null>;
  /**
   * An import run or a deck's source preparation is going (a22-review-combine2 R-S1): it can take up a file or a row
   * in Media by its bytes in two steps without the lock, so nothing unlisted is removed meanwhile.
   */
  importing(): boolean;
}

export function registerVideoCopies(deps: VideoCopyIpcDeps) {
  const cores = availableParallelism();
  const register = (
    file: string,
    info: Parameters<typeof registerProxyFile>[0]['info'],
    signal: AbortSignal,
    name?: string,
  ) =>
    registerProxyFile({
      db: deps.db,
      mediaDir: deps.mediaDir,
      file,
      info,
      // A named new video is one the operator asked for (Export clip…'s Also add the clip to Media): the save gate
      // (alpha.22: only what plays, the stream or a recording holds it); a lighter copy waits until nothing is up.
      idle: () => (name === undefined ? deps.idle() : (deps.saveIdle ?? deps.idle)()),
      freeBytes: (dir) => deps.freeBytes(dir),
      signal,
      name,
      mayRemove: () => !deps.importing(),
    });
  const proxies = new ProxyService({
    mediaDir: deps.mediaDir,
    row: (id) => deps.media.about(id),
    sourceIds: () =>
      (
        deps.db
          .prepare(
            "SELECT id FROM media WHERE kind='video' AND missing=0 AND deleted_at IS NULL ORDER BY rowid LIMIT 10000",
          )
          .all() as { id: string }[]
      ).map((row) => row.id),
    computer: () => {
      const status = deps.gpuStatus();
      const soft =
        typeof status === 'object' &&
        status !== null &&
        ['gpu_compositing', 'video_decode'].some(
          (key) =>
            key in status &&
            typeof (status as Record<string, unknown>)[key] === 'string' &&
            String((status as Record<string, unknown>)[key]).includes('software'),
        );
      return { logicalCores: cores, softwareVideo: soft };
    },
    idle: () => deps.idle(),
    conversions: deps.conversions,
    kept: copyRequests(join(deps.mediaDir, 'video-proxies.json')),
    register: (file, info, signal) => register(file, info, signal),
  });
  // A new video in Media listed only once it is whole and checked (Export's Also add the clip to Media, Combine videos…).
  const publishImport = (id: string): Promise<boolean> => {
    try {
      const result = deps.db.prepare('UPDATE media SET listed=1 WHERE id=? AND deleted_at IS NULL').run(id);
      if (result.changes > 0) deps.libraryChanged();
      return Promise.resolve(result.changes > 0);
    } catch {
      return Promise.resolve(false);
    }
  };
  const clips = new ClipExports({
    conversions: deps.conversions,
    kept: copyRequests(join(deps.mediaDir, 'video-clip-clips.json')),
    resolve: (request) => {
      if (request.frame === 'edited')
        return (
          deps.editedExport?.(request) ?? {
            ok: false,
            message:
              'The edited clip is not ready. Save the edits and wait for preparation, then Export again.',
          }
        );
      const id = deps.sourceId?.(request.mediaId) ?? request.mediaId;
      const row = deps.media.about(id);
      if (row?.kind !== 'video' || row.deleted || row.missing || !row.sha256 || !row.path)
        return {
          ok: false,
          message: 'This video’s original is unavailable. Restore its file before exporting.',
        };
      return {
        ok: true,
        source: {
          mediaId: id,
          sha256: row.sha256,
          path: join(deps.mediaDir, row.path),
          name: row.name,
          identity: `${row.sha256}:original`,
          durationMs: row.durationMs,
          startMs: request.startMs,
          endMs: request.endMs,
        },
      };
    },
    current: (source) => {
      const row = deps.media.about(source.mediaId);
      return (
        !!row &&
        !row.deleted &&
        !row.missing &&
        row.sha256 === source.sha256 &&
        join(deps.mediaDir, row.path) === source.path &&
        existsSync(source.path)
      );
    },
    pickDest: (name, container) => deps.pickDest(name, container),
    prepareImport: (file, info, name, signal) => register(file, info, signal, name),
    publishImport,
    // Also add the clip to Media failing, stopped or let go of late leaves no unlisted row or file (a22-exportclip),
    // removed only at a quiet moment (a22-review-combine2 R-S1, R-S2); what is left is kept for a later start.
    discardUnlisted: (file, keep, allowed) =>
      discardUnlisted({ db: deps.db, mediaDir: deps.mediaDir, file, keep, allowed }),
    quiet: () => (deps.saveIdle ?? deps.idle)() && !deps.importing(),
    left: copyRequests(join(deps.mediaDir, 'video-clip-left.json')),
    leftFrom: (file) => unlistedMadeFrom(deps.db, file),
  });
  // Combine videos… (alpha.22): the chosen videos joined end to end into one new video in Media, by the same worker.
  const combines = new CombineVideos({
    pickCopy: (name) => deps.exportDialog?.(name) ?? Promise.resolve(null),
    mediaDir: deps.mediaDir,
    workDir: join(deps.mediaDir, 'video-combine-work'),
    row: (id) => deps.media.about(id),
    conversions: deps.conversions,
    // The save gate (alpha.22): only what plays, the stream or a recording holds a combine the operator asked for.
    idle: () => (deps.saveIdle ?? deps.idle)(),
    prepareImport: (file, info, name, signal) => register(file, info, signal, name),
    publishImport,
    // A combine failing late leaves no unlisted row or file in Media (a22-review-combine S4), at a quiet moment.
    discardUnlisted: (made, keep, allowed) =>
      discardUnlisted({ db: deps.db, mediaDir: deps.mediaDir, ...made, keep, allowed }),
    importing: () => deps.importing(),
  });
  const allowed = (e: IpcMainInvokeEvent) => deps.fromOperator(e);
  handle(IPC.media.proxyStatus, (e, id, retry) =>
    allowed(e) && typeof id === 'string' && MEDIA_ID_PATTERN.test(id) && typeof retry === 'boolean'
      ? proxies.get(id, retry)
      : { ok: false as const, message: 'Open the video in the operator window to check its lighter copy.' },
  );
  handle(IPC.media.stopProxy, (e, id) =>
    allowed(e) && typeof id === 'string' && MEDIA_ID_PATTERN.test(id) ? proxies.stop(id) : false,
  );
  handle(IPC.media.clipExport, (e, request) =>
    allowed(e) && deps.proMode()
      ? clips.start(request)
      : { ok: false as const, message: 'Open Edit Video in Pro Mode to export a clip.' },
  );
  handle(IPC.media.clipExports, (e) => (allowed(e) ? clips.list() : []));
  handle(IPC.media.stopClipExport, (e, id) =>
    allowed(e) && typeof id === 'string' ? clips.stop(id) : false,
  );
  handle(IPC.media.showClipExport, (e, id) => {
    const job = allowed(e) ? clips.list().find((job) => job.id === id && job.state === 'done') : undefined;
    if (job?.path) deps.showFile(job.path);
    return null;
  });
  handle(IPC.media.combineVideos, (e, request) =>
    allowed(e) && deps.proMode()
      ? combines.start(request)
      : { ok: false as const, message: 'Open Media in Pro Mode to combine videos.' },
  );
  handle(IPC.media.combineList, (e) => (allowed(e) ? combines.list() : []));
  handle(IPC.media.stopCombine, (e, id) =>
    allowed(e) && typeof id === 'string' ? combines.stop(id) : false,
  );
  const timer = setTimeout(() => {
    proxies.resume();
    clips.resume();
  }, AFTER_START_MS);
  return {
    proxies,
    clips,
    combines,
    close: () => {
      clearTimeout(timer);
      combines.close();
      clips.close();
      proxies.close();
    },
  };
}
