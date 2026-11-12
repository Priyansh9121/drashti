import { realpath, rm } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import type { MediaMarkers } from '../../shared/markers';
import type { RowTrimRequest, RowTrimResult } from '../../shared/trim';
import type { TrimmedVideos } from '../db/trimmed';
import { sha256File } from '../import/media-store';
import { isInside } from '../media/contained';
import type { FitResult } from './convert-service';
import { TARGET_FORMAT } from './plan';
import type { MediaInfo } from './plan';
import type { TrimCopyInput } from './trim-copy';

type TrimSource = NonNullable<ReturnType<TrimmedVideos['row']>>;

interface PlaylistTrimsDeps {
  repo: TrimmedVideos;
  mediaDir: string;
  readInfo(path: string): Promise<MediaInfo>;
  queue(input: TrimCopyInput): { id: string; done: Promise<FitResult> };
  cancel(id: string): boolean;
  pendingChanged(ids: string[]): void;
  rowChanged(added: string | null): void;
  markersChanged(mediaId: string): void;
  notice(text: string): void;
}

interface PendingTrim {
  queueId: string | null;
}

const CHANGED = {
  ok: false as const,
  message: 'That playlist row changed. Open Trim again to see the current video.',
};
const FAILED = 'Drashti couldn’t keep the trimmed video. Check the file in Media and try again.';

/** A row keeps playing its current video until the queued cut has been checked and saved. */
export class PlaylistTrims {
  private readonly pending = new Map<string, PendingTrim>();
  private closed = false;

  constructor(private readonly deps: PlaylistTrimsDeps) {}

  list(): string[] {
    return [...this.pending.keys()];
  }

  async apply(itemId: string, { mediaId, points }: RowTrimRequest): Promise<RowTrimResult> {
    const row = this.deps.repo.row(itemId);
    if (!row || row.mediaId !== mediaId || this.closed) return CHANGED;
    if (this.pending.has(itemId))
      return { ok: false, message: 'This video is already being trimmed. Wait for Preparing to clear.' };

    const previous = this.deps.repo.view(itemId)?.markers;
    const unchangedCut =
      row.cutEndMs !== null
        ? (points.startMs ?? 0) === row.cutStartMs && points.endMs === row.cutEndMs
        : previous?.startMs === null &&
          previous.endMs === null &&
          points.startMs === null &&
          points.endMs === null;
    if (unchangedCut) {
      if (!this.deps.repo.keepMarkers(row, points)) return CHANGED;
      this.deps.markersChanged(mediaId);
      return { ok: true };
    }

    const pending: PendingTrim = { queueId: null };
    this.pending.set(itemId, pending);
    this.deps.pendingChanged(this.list());
    try {
      const [mediaDir, path] = await Promise.all([
        realpath(this.deps.mediaDir),
        realpath(join(this.deps.mediaDir, row.sourcePath)),
      ]);
      if (!isInside(mediaDir, path))
        return { ok: false, message: 'The original video is outside Media. Import it again to trim it.' };
      const info = await this.deps.readInfo(path);
      if (this.pending.get(itemId) !== pending || !this.deps.repo.current(row)) return CHANGED;
      if (!info.video || info.video.still)
        return { ok: false, message: 'Drashti couldn’t read the original video. Check the file in Media.' };
      const startMs = points.startMs ?? 0;
      const endMs = points.endMs ?? info.durationMs;
      // FFmpeg reports the source length to centiseconds. The preview can read the last few milliseconds.
      if (endMs === null || endMs <= startMs || (info.durationMs !== null && endMs > info.durationMs + 10))
        return {
          ok: false,
          message: 'Choose a start and end within the original video, with the end later.',
        };

      const queued = this.deps.queue({
        path,
        name: row.sourceName,
        info,
        alpha: row.sourceFormat?.includes('video with transparency'),
        startMs,
        endMs,
      });
      pending.queueId = queued.id;
      void this.finish(row, pending, queued.done, mediaDir, startMs, endMs, points);
      return { ok: true };
    } catch {
      return { ok: false, message: FAILED };
    } finally {
      if (pending.queueId === null) this.clear(row.itemId, pending);
    }
  }

  reset(itemId: string, mediaId: string): RowTrimResult {
    const row = this.deps.repo.row(itemId);
    if (!row || row.mediaId !== mediaId || !this.deps.repo.reset(row)) return CHANGED;
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
    for (const pending of this.pending.values()) {
      if (pending.queueId !== null) this.deps.cancel(pending.queueId);
    }
    this.pending.clear();
  }

  private clear(itemId: string, pending: PendingTrim): void {
    if (this.pending.get(itemId) !== pending) return;
    this.pending.delete(itemId);
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
        if (stillPending() && !result.stopped) this.deps.notice(result.message);
        return;
      }
      unclaimed = result.copy;
      if (!stillPending()) return;
      if (!unclaimed) {
        this.deps.notice(FAILED);
        return;
      }
      const info = await this.deps.readInfo(unclaimed);
      if (!stillPending()) return;
      if (!info.video || info.video.still || !info.durationMs) {
        this.deps.notice('The cut has no video frames. Choose a longer part and save it again.');
        return;
      }
      const { sha256, bytes } = await sha256File(unclaimed);
      if (!stillPending()) return;
      const ext = extname(unclaimed);
      const adopted = this.deps.repo.adopt(
        row,
        {
          name: basename(unclaimed, ext),
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
      } else {
        this.deps.notice(CHANGED.message);
      }
    } catch {
      if (stillPending()) this.deps.notice(FAILED);
    } finally {
      if (unclaimed) await rm(unclaimed, { force: true }).catch(() => undefined);
      this.clear(row.itemId, pending);
    }
  }
}
