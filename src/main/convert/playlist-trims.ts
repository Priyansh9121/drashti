import { realpath, rm } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { MediaMarkers } from '../../shared/markers';
import { idSchema } from '../../shared/model-schema';
import type { RowTrimRequest, RowTrimResult } from '../../shared/trim';
import type { TrimmedVideos } from '../db/trimmed';
import { sha256File } from '../import/media-store';
import { isInside } from '../media/contained';
import type { FitResult } from './convert-service';
import { TARGET_FORMAT } from './plan';
import type { MediaInfo } from './plan';
import type { TrimCopyInput } from './trim-copy';

type TrimSource = NonNullable<ReturnType<TrimmedVideos['row']>>;

const keptTrimSchema = z.object({ itemId: idSchema, mediaId: idSchema, name: z.string().min(1) });
const keptTrimsSchema = z.array(keptTrimSchema);
type KeptTrim = z.infer<typeof keptTrimSchema>;

interface PlaylistTrimsDeps {
  repo: TrimmedVideos;
  mediaDir: string;
  readInfo(path: string): Promise<MediaInfo>;
  frameAt(path: string, atMs: number): Promise<number | null>;
  queue(input: TrimCopyInput): { id: string; done: Promise<FitResult> };
  cancel(id: string): boolean;
  isLive(itemId: string, mediaId: string): boolean;
  kept: {
    load(): unknown;
    save(cuts: KeptTrim[]): void;
  };
  pendingChanged(ids: string[]): void;
  rowChanged(added: string | null): void;
  markersChanged(mediaId: string): void;
  notice(text: string): void;
}

interface PendingTrim {
  queueId: string | null;
  kept: KeptTrim | null;
  wake: (() => void) | null;
}

const CHANGED = {
  ok: false as const,
  message: 'That playlist row changed. Open Trim again to see the current video.',
};
const FAILED = 'Drashti couldn’t keep the trimmed video. Check the video file and try Trim again.';
const RESET_LIVE = 'Take the video off before resetting this row.';

function cutFailed(name: string, reason: string): string {
  const help = reason.includes('2 GB free')
    ? 'Free up some disk space, then open Trim and save it again.'
    : 'Open Trim and save it again.';
  return `Drashti couldn’t make the cut of “${name}”. ${help}`;
}

/** A row keeps playing its current video until the queued cut has been checked and saved. */
export class PlaylistTrims {
  private readonly pending = new Map<string, PendingTrim>();
  private interrupted: KeptTrim[];
  private closed = false;

  constructor(private readonly deps: PlaylistTrimsDeps) {
    this.interrupted = keptTrimsSchema.safeParse(deps.kept.load()).data ?? [];
  }

  list(): string[] {
    return [...this.pending.keys()];
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
      return this.reset(itemId, mediaId);
    if (this.pending.has(itemId))
      return { ok: false, message: 'This video is already being trimmed. Wait for Preparing to clear.' };
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

      if (requestedStart === 0 && info.durationMs !== null && endMs >= info.durationMs)
        return before.canReset
          ? this.reset(itemId, mediaId)
          : this.saveMarkers(row, { ...points, startMs: null, endMs: null });

      const startMs = await this.deps.frameAt(path, requestedStart);
      if (this.pending.get(itemId) !== pending || !this.deps.repo.current(row)) return CHANGED;
      if (startMs === null || startMs >= endMs)
        return {
          ok: false,
          message: 'Drashti couldn’t find the starting frame. Choose a different start and save again.',
        };

      pending.kept = { itemId, mediaId, name: row.sourceName };
      this.keepWaiting();
      const queued = this.deps.queue({
        path,
        name: row.sourceName,
        info,
        alpha: row.sourceFormat?.includes('video with transparency'),
        startMs,
        endMs,
      });
      pending.queueId = queued.id;
      // Store the first whole millisecond of the frame, so reopening and widening starts on the same frame.
      void this.finish(row, pending, queued.done, mediaDir, Math.ceil(startMs - 0.000_001), endMs, points);
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
    if (this.deps.isLive(itemId, mediaId)) return { ok: false, message: RESET_LIVE };
    if (!this.deps.repo.reset(row)) return CHANGED;
    const pending = this.pending.get(itemId);
    if (pending) {
      if (pending.queueId !== null) this.deps.cancel(pending.queueId);
      this.clear(itemId, pending);
    }
    this.deps.rowChanged(null);
    return { ok: true };
  }

  close(): void {
    this.closed = true;
    // The next start tells the operator about accepted cuts that were interrupted.
    const pendingCuts = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingCuts) {
      pending.wake?.();
      if (pending.queueId !== null) this.deps.cancel(pending.queueId);
    }
  }

  private keepWaiting(): void {
    const kept = [...this.interrupted];
    for (const pending of this.pending.values()) if (pending.kept) kept.push(pending.kept);
    this.deps.kept.save(kept);
  }

  private clear(itemId: string, pending: PendingTrim): void {
    if (this.pending.get(itemId) !== pending) return;
    this.pending.delete(itemId);
    pending.wake?.();
    if (pending.kept) this.keepWaiting();
    this.deps.pendingChanged(this.list());
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
    let unclaimed: string | null = null;
    const stillPending = () => this.pending.get(row.itemId) === pending;
    try {
      const result = await done;
      if (!result.ok) {
        if (stillPending() && !result.stopped) this.deps.notice(cutFailed(row.sourceName, result.message));
        return;
      }
      unclaimed = result.copy && isInside(mediaDir, result.copy) ? result.copy : null;
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
        unclaimed = null;
        this.deps.rowChanged(adopted);
      } else if (this.deps.repo.row(row.itemId)) {
        this.deps.notice(CHANGED.message);
      }
    } catch {
      if (stillPending()) this.deps.notice(cutFailed(row.sourceName, ''));
    } finally {
      if (unclaimed) await rm(unclaimed, { force: true }).catch(() => undefined);
      this.clear(row.itemId, pending);
    }
  }
}
