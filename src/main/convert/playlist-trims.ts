import { lstatSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { mediaMarkersSchema, type MediaMarkers } from '../../shared/markers';
import { idSchema } from '../../shared/model-schema';
import type { RowTrimRequest, RowTrimResult } from '../../shared/trim';
import type { TrimMarkerEdits, TrimmedVideos } from '../db/trimmed';
import { sha256File } from '../import/media-store';
import { isInside } from '../media/contained';
import type { FitResult } from './convert-service';
import { TARGET_FORMAT } from './plan';
import type { MediaInfo } from './plan';
import type { TrimCopyInput } from './trim-copy';

type TrimSource = NonNullable<ReturnType<TrimmedVideos['row']>>;

const trimCopySchema = z.object({ path: z.string().min(1), identity: z.string().min(1) });
const trimCopiesSchema = z.array(trimCopySchema);
type TrimCopy = z.infer<typeof trimCopySchema>;
const keptTrimSchema = z.object({
  itemId: idSchema,
  mediaId: idSchema,
  name: z.string().min(1),
  request: z
    .object({
      sourceId: idSchema,
      sourcePath: z.string().min(1),
      sourceIdentity: z.string().min(1),
      points: mediaMarkersSchema,
      startMs: z.number().int().nonnegative(),
      endMs: z.number().positive(),
    })
    .optional(),
  copy: trimCopySchema.optional(),
});
const keptTrimsSchema = z.array(keptTrimSchema);
type KeptTrim = z.infer<typeof keptTrimSchema>;

function fileIdentity(file: string): string | null {
  const stat = lstatSync(file, { bigint: true, throwIfNoEntry: false });
  return stat?.isFile() ? [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':') : null;
}

interface PlaylistTrimsDeps {
  repo: TrimmedVideos;
  mediaDir: string;
  readInfo(path: string): Promise<MediaInfo>;
  frameAt(path: string, atMs: number): Promise<number | null>;
  spaceProblem(path: string, durationMs: number | null, lengthMs: number): string | null;
  queue(
    input: TrimCopyInput,
    beforePublish: (temporary: string, destination: string) => void,
  ): { id: string; done: Promise<FitResult> };
  cancel(id: string): boolean;
  isLive(itemId: string, mediaId: string): boolean;
  kept: {
    load(): unknown;
    save(cuts: KeptTrim[]): void;
  };
  copies: {
    load(): unknown;
    save(copies: TrimCopy[]): void;
  };
  trash(file: string): Promise<void>;
  pendingChanged(ids: string[]): void;
  rowChanged(added: string | null): void;
  markersChanged(mediaId: string): void;
  notice(text: string): void;
}

interface PendingTrim {
  queueId: string | null;
  kept: KeptTrim | null;
  copy?: TrimCopy;
  preserveOnClose?: boolean;
  wake: (() => void) | null;
}

const CHANGED = {
  ok: false as const,
  message: 'That playlist row changed. Open Trim again to see the current video.',
};
const FAILED = 'Drashti couldn’t keep the trimmed video. Check the video file and try Trim again.';
const RESET_LIVE = 'Take the video off before resetting this row.';

function cutFailed(name: string, reason: string): string {
  const failed = `Drashti couldn’t make the cut of “${name}”.`;
  if (reason.includes('2 GB free'))
    return `${failed} Free up some disk space, then open Trim and save it again.`;
  if (reason.endsWith('Install Drashti again.')) return `${failed} Install Drashti again.`;
  if (reason.startsWith('Stopped: saving it took longer than '))
    return `${failed} It took too long. Choose a shorter part and save it again.`;
  if (
    reason.startsWith('Drashti could not write in its own folder:') ||
    reason.startsWith('Drashti could not save it there:')
  )
    return `${failed} Ask the admin to check Drashti’s media folder, then open Trim and save it again.`;
  return `${failed} Open Trim and save it again.`;
}

function resetMarkerEdits(before: MediaMarkers, after: MediaMarkers): TrimMarkerEdits | undefined {
  const previous = new Map(before.markers.map((marker) => [marker.id, marker]));
  const changed = after.markers.filter((marker) => {
    const old = previous.get(marker.id);
    previous.delete(marker.id);
    return old?.atMs !== marker.atMs || old.name !== marker.name;
  });
  const removed = [...previous.keys()];
  return changed.length || removed.length ? { changed, removed } : undefined;
}

/** A row keeps playing its current video until the queued cut has been checked and saved. */
export class PlaylistTrims {
  private readonly pending = new Map<string, PendingTrim>();
  private readonly copies: Set<TrimCopy>;
  private interrupted: KeptTrim[];
  private closed = false;

  constructor(private readonly deps: PlaylistTrimsDeps) {
    this.interrupted = keptTrimsSchema.safeParse(deps.kept.load()).data ?? [];
    this.copies = new Set(trimCopiesSchema.safeParse(deps.copies.load()).data ?? []);
  }

  list(): string[] {
    return [...this.pending.keys()];
  }

  /** Continue accepted work only when the row and its original still match. */
  async resumeInterrupted(): Promise<void> {
    for (const cut of [...this.interrupted]) {
      if (this.closed) return;
      const request = cut.request;
      const row = this.deps.repo.row(cut.itemId);
      if (!request || row?.mediaId !== cut.mediaId || this.pending.has(cut.itemId)) continue;
      if (row.sourceId !== request.sourceId || row.sourcePath !== request.sourcePath) continue;
      try {
        const mediaDir = realpathSync.native(this.deps.mediaDir);
        const source = realpathSync.native(join(mediaDir, row.sourcePath));
        if (!isInside(mediaDir, source) || fileIdentity(source) !== request.sourceIdentity) continue;

        const savedCopy = cut.copy;
        const copy =
          savedCopy &&
          [...this.copies].find(
            (candidate) => candidate.path === savedCopy.path && candidate.identity === savedCopy.identity,
          );
        const path = copy ? this.copyPath(mediaDir, copy) : null;
        if (copy && path && !this.deps.repo.referencesFile(copy.path, path)) {
          const pending: PendingTrim = { queueId: null, kept: cut, copy, wake: null };
          this.pending.set(cut.itemId, pending);
          this.deps.pendingChanged(this.list());
          void this.finish(
            row,
            pending,
            Promise.resolve({ ok: true, copy: path }),
            mediaDir,
            request.startMs,
            request.endMs,
            request.points,
          );
          this.removeInterrupted(cut);
        } else {
          const result = await this.apply(cut.itemId, { mediaId: cut.mediaId, points: request.points });
          if (result.ok) this.removeInterrupted(cut);
        }
      } catch {
        // The operator can reopen Trim when the original or a saved cut could not be checked.
      }
    }
  }

  private removeInterrupted(cut: KeptTrim): void {
    this.interrupted = this.interrupted.filter((record) => record !== cut);
    this.keepWaiting();
  }

  /** The operator reads this once at startup, after the window can show a notice. */
  reportInterrupted(): string | null {
    if (this.interrupted.length === 0) return null;
    const missed = this.interrupted.filter((cut) => this.deps.repo.row(cut.itemId)?.mediaId === cut.mediaId);
    this.interrupted = [];
    this.keepWaiting();
    if (missed.length === 0) return null;
    const names = new Intl.ListFormat('en').format([...new Set(missed.map((cut) => `“${cut.name}”`))]);
    return missed.length === 1
      ? `The cut of ${names} wasn’t made because Drashti closed. Open Trim and save it again.`
      : `The cuts of ${names} weren’t made because Drashti closed. Open Trim and save them again.`;
  }

  /** A finished copy can replace its row only after that row's video has come off. */
  activityChanged(): void {
    for (const pending of this.pending.values()) pending.wake?.();
  }

  async apply(itemId: string, { mediaId, points }: RowTrimRequest): Promise<RowTrimResult> {
    const row = this.deps.repo.row(itemId);
    if (row?.mediaId !== mediaId || this.closed) return CHANGED;
    const before = this.deps.repo.view(itemId);
    if (!before) return CHANGED;
    if (points.startMs === null && points.endMs === null && before.canReset)
      return this.resetRow(row, resetMarkerEdits(before.markers, points));
    if (this.pending.has(itemId))
      return {
        ok: false,
        message:
          'This video is already being trimmed. Wait for Preparing to clear, or open Trim again and press Stop.',
      };
    if ((points.startMs ?? 0) === (before.markers.startMs ?? 0) && points.endMs === before.markers.endMs)
      return this.saveMarkers(row, points);

    const pending: PendingTrim = { queueId: null, kept: null, wake: null };
    this.pending.set(itemId, pending);
    this.deps.pendingChanged(this.list());
    try {
      const [mediaDir, path] = await Promise.all([
        realpath(this.deps.mediaDir),
        realpath(join(this.deps.mediaDir, row.sourcePath)),
      ]);
      if (!isInside(mediaDir, path))
        return {
          ok: false,
          message: 'Drashti couldn’t open the original file. Add the original video to the playlist again.',
        };
      const info = await this.deps.readInfo(path);
      if (this.pending.get(itemId) !== pending || !this.deps.repo.current(row)) return CHANGED;
      if (!info.video || info.video.still)
        return {
          ok: false,
          message: 'Drashti couldn’t read the original video. Check the video file and try Trim again.',
        };
      const requestedStart = points.startMs ?? 0;
      const endMs = points.endMs ?? info.durationMs;
      // FFmpeg reports the source length to centiseconds. The preview can read the last few milliseconds.
      if (
        endMs === null ||
        endMs <= requestedStart ||
        (info.durationMs !== null && endMs > info.durationMs + 10)
      )
        return {
          ok: false,
          message: 'Choose a start and end within the original video, with the end later.',
        };

      const frame =
        requestedStart === 0 ? 0 : await this.deps.frameAt(path, requestedStart).catch(() => null);
      if (this.pending.get(itemId) !== pending || !this.deps.repo.current(row)) return CHANGED;
      const startMs = frame !== null && frame < endMs ? frame : requestedStart;
      if (startMs === 0 && info.durationMs !== null && endMs >= info.durationMs)
        return before.canReset
          ? this.resetRow(row, resetMarkerEdits(before.markers, points))
          : this.saveMarkers(row, { ...points, startMs: null, endMs: null });

      const space = this.deps.spaceProblem(path, info.durationMs, endMs - startMs);
      if (space) return { ok: false, message: space };

      const sourceIdentity = fileIdentity(path);
      if (!sourceIdentity) return CHANGED;
      // Keep the first whole millisecond of the frame for adoption after a restart.
      const cutStart = Math.ceil(startMs - 0.000_001);
      pending.kept = {
        itemId,
        mediaId,
        name: row.sourceName,
        request: {
          sourceId: row.sourceId,
          sourcePath: row.sourcePath,
          sourceIdentity,
          points,
          startMs: cutStart,
          endMs,
        },
      };
      this.keepWaiting();
      const queued = this.deps.queue(
        {
          path,
          name: row.sourceName,
          info,
          alpha: row.sourceFormat?.includes('video with transparency'),
          startMs,
          endMs,
        },
        (temporary, destination) => this.rememberCopy(mediaDir, pending, temporary, destination),
      );
      pending.queueId = queued.id;
      void this.finish(row, pending, queued.done, mediaDir, cutStart, endMs, points);
      return { ok: true };
    } catch {
      return { ok: false, message: FAILED };
    } finally {
      if (pending.queueId === null) this.clear(row.itemId, pending);
    }
  }

  private saveMarkers(row: TrimSource, points: MediaMarkers): RowTrimResult {
    if (!this.deps.repo.keepMarkers(row, points)) return CHANGED;
    this.deps.markersChanged(row.mediaId);
    return { ok: true };
  }

  reset(itemId: string, mediaId: string): RowTrimResult {
    const row = this.deps.repo.row(itemId);
    if (row?.mediaId !== mediaId) return CHANGED;
    return this.resetRow(row);
  }

  stop(itemId: string, mediaId: string): RowTrimResult {
    const row = this.deps.repo.row(itemId);
    if (this.closed || row?.mediaId !== mediaId) return CHANGED;
    if (!this.cancelPending(itemId))
      return {
        ok: false,
        message: 'This cut is no longer preparing. Open Trim again to see the video’s points.',
      };
    return { ok: true };
  }

  private cancelPending(itemId: string): boolean {
    const pending = this.pending.get(itemId);
    if (!pending) return false;
    if (pending.queueId !== null) this.deps.cancel(pending.queueId);
    this.clear(itemId, pending);
    return true;
  }

  private resetRow(row: TrimSource, edits?: TrimMarkerEdits): RowTrimResult {
    if (this.deps.isLive(row.itemId, row.mediaId)) return { ok: false, message: RESET_LIVE };
    const reset = this.deps.repo.reset(row, edits);
    if (reset === 'too-many-markers')
      return {
        ok: false,
        message: 'The original can hold up to 50 markers. Remove a marker and save again.',
      };
    if (reset === 'changed') return CHANGED;
    this.cancelPending(row.itemId);
    this.deps.rowChanged(null);
    if (edits) this.deps.markersChanged(row.sourceId);
    return { ok: true };
  }

  close(): void {
    this.closed = true;
    // Accepted work stays recorded for the next start, including any complete copy.
    const pendingCuts = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingCuts) {
      pending.preserveOnClose = pending.kept?.request !== undefined;
      pending.wake?.();
      if (pending.queueId !== null) this.deps.cancel(pending.queueId);
    }
  }

  private keepWaiting(): void {
    const kept = new Map(this.interrupted.map((cut) => [cut.itemId, cut]));
    for (const pending of this.pending.values())
      if (pending.kept) kept.set(pending.kept.itemId, pending.kept);
    this.deps.kept.save([...kept.values()]);
  }

  private clear(itemId: string, pending: PendingTrim): void {
    if (this.pending.get(itemId) !== pending) return;
    this.pending.delete(itemId);
    pending.wake?.();
    if (pending.kept) this.keepWaiting();
    this.deps.pendingChanged(this.list());
  }

  /** The settings write completes before ConvertService publishes the cut. */
  private rememberCopy(mediaDir: string, pending: PendingTrim, temporary: string, destination: string): void {
    if (!pending.kept || this.pending.get(pending.kept.itemId) !== pending)
      throw new Error('The cut stopped before publication.');
    if (!isInside(mediaDir, temporary) || !isInside(mediaDir, destination))
      throw new Error('The cut is outside the Media folder.');
    const identity = fileIdentity(temporary);
    if (!identity) throw new Error('The temporary cut is missing.');
    const copy = { path: relative(mediaDir, destination).split(sep).join('/'), identity };
    pending.copy = copy;
    this.copies.add(copy);
    this.deps.copies.save([...this.copies]);
    pending.kept.copy = copy;
    this.keepWaiting();
  }

  /** Retry cleanup for copies left without a current accepted Trim. */
  async cleanupCopies(): Promise<void> {
    const active = new Set([...this.pending.values()].map((pending) => pending.copy));
    for (const copy of [...this.copies]) if (!active.has(copy)) await this.discardCopy(copy);
  }

  private copyPath(mediaDir: string, copy: TrimCopy): string | null {
    const candidate = resolve(mediaDir, copy.path);
    if (!isInside(mediaDir, candidate) || fileIdentity(candidate) !== copy.identity) return null;
    const real = realpathSync.native(candidate);
    return isInside(mediaDir, real) && relative(mediaDir, real).split(sep).join('/') === copy.path
      ? real
      : null;
  }

  private async discardCopy(copy: TrimCopy): Promise<void> {
    try {
      const mediaDir = realpathSync.native(this.deps.mediaDir);
      const path = this.copyPath(mediaDir, copy);
      if (path && !this.deps.repo.referencesFile(copy.path, path)) await this.deps.trash(path);
      this.copies.delete(copy);
      this.deps.copies.save([...this.copies]);
    } catch {
      // Leave the record for the next start if the file could not be checked or moved.
      this.copies.add(copy);
    }
  }

  private async finish(
    row: TrimSource,
    pending: PendingTrim,
    done: Promise<FitResult>,
    mediaDir: string,
    startMs: number,
    endMs: number,
    points: MediaMarkers,
  ): Promise<void> {
    const stillPending = () => this.pending.get(row.itemId) === pending;
    try {
      const result = await done;
      if (!result.ok) {
        if (stillPending() && !result.stopped) this.deps.notice(cutFailed(row.sourceName, result.message));
        return;
      }
      const unclaimed = result.copy && isInside(mediaDir, result.copy) ? result.copy : null;
      if (!stillPending()) return;
      if (!unclaimed) {
        this.deps.notice(cutFailed(row.sourceName, ''));
        return;
      }
      const info = await this.deps.readInfo(unclaimed);
      if (!stillPending()) return;
      if (!info.video || info.video.still || !info.durationMs) {
        this.deps.notice(
          `The cut of “${row.sourceName}” has no video frames. Choose a longer part and save it again.`,
        );
        return;
      }
      const { sha256, bytes } = await sha256File(unclaimed);
      // The show may have started while the finished file was being checked. Recheck after every wake,
      // then publish in the same turn, so the live row keeps what it does when the current video ends.
      while (stillPending() && this.deps.isLive(row.itemId, row.mediaId)) {
        await new Promise<void>((resolve) => {
          pending.wake = () => {
            if (stillPending() && this.deps.isLive(row.itemId, row.mediaId)) return;
            pending.wake = null;
            resolve();
          };
        });
      }
      if (!stillPending()) return;
      const ext = extname(unclaimed);
      const adopted = this.deps.repo.adopt(
        row,
        {
          name: basename(unclaimed),
          path: relative(mediaDir, unclaimed).split(sep).join('/'),
          sha256,
          bytes,
          durationMs: info.durationMs,
          width: info.video.width,
          height: info.video.height,
          format: ext === '.webm' ? TARGET_FORMAT['webm-alpha'] : TARGET_FORMAT.mp4,
        },
        startMs,
        endMs,
        points,
      );
      if (adopted) {
        this.deps.rowChanged(adopted);
      } else if (this.deps.repo.row(row.itemId)) {
        this.deps.notice(CHANGED.message);
      }
    } catch {
      if (stillPending()) this.deps.notice(cutFailed(row.sourceName, ''));
    } finally {
      if (pending.copy && !pending.preserveOnClose) await this.discardCopy(pending.copy);
      this.clear(row.itemId, pending);
    }
  }
}
