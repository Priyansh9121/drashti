import { lstatSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { mediaMarkersSchema, type MediaMarkers } from '../../shared/markers';
import { idSchema } from '../../shared/model-schema';
import type { RowTrimRequest, RowTrimResult } from '../../shared/trim';
import type { TrimMarkerEdits, TrimmedVideos } from '../db/trimmed';
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
type KeptRequest = NonNullable<KeptTrim['request']>;

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
  /** Background work may go on (Q57-7): nothing up on LIVE, no stream on air or recording, not quitting. */
  quiet(): boolean;
  /** A file's sha256 and length, read off Main's thread (library/hash-off-main.ts); stops when `signal` aborts. */
  hash(file: string, signal: AbortSignal): Promise<{ sha256: string; bytes: number }>;
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
  /** Stops checking the finished file (the show started, or the cut stopped). */
  stopCheck?: () => void;
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
  /** The start notice has named the cuts that cannot carry on. */
  private reported = false;
  /**
   * The cuts accepted before Drashti closed (TR-5): held until the start is known (resumeWhenQuiet), then waiting for
   * a quiet moment, going, and done.
   */
  private resuming: 'held' | 'waiting' | 'going' | 'done' = 'held';
  private closed = false;

  constructor(private readonly deps: PlaylistTrimsDeps) {
    this.interrupted = keptTrimsSchema.safeParse(deps.kept.load()).data ?? [];
    this.copies = new Set(trimCopiesSchema.safeParse(deps.copies.load()).data ?? []);
  }

  list(): string[] {
    return [...this.pending.keys()];
  }

  /**
   * The start is known (index.ts: the operator window has loaded and the stream's own restart is done, then the same
   * 10 s as kept conversions): the cuts accepted before Drashti closed carry on at the first quiet moment.
   */
  resumeWhenQuiet(): void {
    if (this.resuming !== 'held' || this.closed) return;
    this.resuming = 'waiting';
    this.activityChanged();
  }

  /** A cut accepted before Drashti closed can carry on: its row, its original and the original's file are as they were. */
  private canResume(cut: KeptTrim): { row: TrimSource; request: KeptRequest; mediaDir: string } | null {
    const request = cut.request;
    if (!request) return null;
    const row = this.deps.repo.row(cut.itemId);
    if (
      row?.mediaId !== cut.mediaId ||
      row.sourceId !== request.sourceId ||
      row.sourcePath !== request.sourcePath
    )
      return null;
    try {
      const mediaDir = realpathSync.native(this.deps.mediaDir);
      const source = realpathSync.native(join(mediaDir, row.sourcePath));
      return isInside(mediaDir, source) && fileIdentity(source) === request.sourceIdentity
        ? { row, request, mediaDir }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Carry on the accepted cuts, one by one, while quiet (Q57-7): the show starting stops it until the next quiet
   * moment. A finished cut is taken in without encoding it again; a waiting one is made again from its request.
   */
  private async resumeInterrupted(): Promise<void> {
    this.resuming = 'going';
    // Read anew after each wait: Drashti may close meanwhile.
    const closed = () => this.closed;
    for (const cut of [...this.interrupted]) {
      if (closed()) return;
      if (!this.interrupted.includes(cut)) continue;
      if (!this.deps.quiet()) {
        this.resuming = 'waiting';
        return;
      }
      const start = this.canResume(cut);
      if (!start) {
        // The start notice names it (or has, and the operator changed its row since): Trim is opened again.
        if (this.reported) this.removeInterrupted(cut);
        continue;
      }
      const { row, request, mediaDir } = start;
      try {
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
          this.removeInterrupted(cut);
          void this.finish(
            row,
            pending,
            Promise.resolve({ ok: true, copy: path }),
            mediaDir,
            request.startMs,
            request.endMs,
            request.points,
          );
          continue;
        }
        const result = await this.applyRequest(cut.itemId, { mediaId: cut.mediaId, points: request.points });
        if (closed()) return;
        this.removeInterrupted(cut);
        if (!result.ok && result.message !== CHANGED.message)
          this.deps.notice(cutFailed(cut.name, result.message));
      } catch {
        if (closed()) return;
        this.removeInterrupted(cut);
        this.deps.notice(cutFailed(cut.name, ''));
      }
    }
    this.resuming = 'done';
    // Copies that nothing carries on now (their cut let go, or from before cuts carried on) go to the Trash.
    await this.cleanupCopies();
  }

  private removeInterrupted(cut: KeptTrim): void {
    this.interrupted = this.interrupted.filter((record) => record !== cut);
    this.keepWaiting();
  }

  /** The operator's own Trim or Reset of a row takes the place of that row's cut accepted before Drashti closed. */
  private forgetInterrupted(itemId: string): void {
    if (!this.interrupted.some((cut) => cut.itemId === itemId)) return;
    this.interrupted = this.interrupted.filter((cut) => cut.itemId !== itemId);
    this.keepWaiting();
  }

  /**
   * The operator reads this once at startup, after the window can show a notice. It waits for no FFmpeg: it names
   * the cuts that cannot carry on (their row, original or original's file changed, or a record from before cuts
   * carried on), by the cheap checks alone; the rest carry on once the start is known.
   */
  reportInterrupted(): string | null {
    this.reported = true;
    const cannot = this.interrupted.filter((cut) => this.canResume(cut) === null);
    if (cannot.length === 0) return null;
    this.interrupted = this.interrupted.filter((cut) => !cannot.includes(cut));
    this.keepWaiting();
    const missed = cannot.filter((cut) => this.deps.repo.row(cut.itemId)?.mediaId === cut.mediaId);
    if (missed.length === 0) return null;
    const names = new Intl.ListFormat('en').format([...new Set(missed.map((cut) => `“${cut.name}”`))]);
    return missed.length === 1
      ? `The cut of ${names} wasn’t made because Drashti closed. Open Trim and save it again.`
      : `The cuts of ${names} weren’t made because Drashti closed. Open Trim and save them again.`;
  }

  /**
   * The show, the stream or a recording changed. A finished copy can replace its row only after that row's video has
   * come off; checking it, and carrying on the accepted cuts, stop while anything is up and go on once quiet.
   */
  activityChanged(): void {
    const quiet = this.deps.quiet();
    for (const pending of this.pending.values()) {
      if (!quiet) pending.stopCheck?.();
      pending.wake?.();
    }
    if (quiet && this.resuming === 'waiting' && !this.closed)
      void this.resumeInterrupted().catch(() => {
        this.resuming = 'done';
      });
  }

  /** The operator's Trim of a row: it takes the place of any cut of that row accepted before Drashti closed. */
  async apply(itemId: string, request: RowTrimRequest): Promise<RowTrimResult> {
    this.forgetInterrupted(itemId);
    return this.applyRequest(itemId, request);
  }

  private async applyRequest(itemId: string, { mediaId, points }: RowTrimRequest): Promise<RowTrimResult> {
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
    this.forgetInterrupted(itemId);
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
      pending.stopCheck?.();
      pending.wake?.();
      if (pending.queueId !== null) this.deps.cancel(pending.queueId);
    }
  }

  private keepWaiting(): void {
    // What was accepted when Drashti closed stays as it was saved then.
    if (this.closed) return;
    const kept = new Map(this.interrupted.map((cut) => [cut.itemId, cut]));
    for (const pending of this.pending.values())
      if (pending.kept) kept.set(pending.kept.itemId, pending.kept);
    this.deps.kept.save([...kept.values()]);
  }

  private clear(itemId: string, pending: PendingTrim): void {
    if (this.pending.get(itemId) !== pending) return;
    this.pending.delete(itemId);
    pending.stopCheck?.();
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

  /** Wait (woken by activityChanged, Stop and quitting) until `ready` holds. */
  private async waitUntil(pending: PendingTrim, ready: () => boolean): Promise<void> {
    while (!ready()) {
      await new Promise<void>((resolve) => {
        pending.wake = () => {
          if (!ready()) return;
          pending.wake = null;
          resolve();
        };
      });
    }
  }

  /**
   * Probe and hash a finished cut (Q57-7): only while nothing is up and the stream is neither on air nor recording,
   * the bytes read off Main's thread. The show starting stops the check, and it goes again at the next quiet moment.
   * Null once the cut is no longer pending.
   */
  private async checkWhenQuiet(
    pending: PendingTrim,
    stillPending: () => boolean,
    file: string,
  ): Promise<{ info: MediaInfo; sha256: string | null; bytes: number } | null> {
    for (;;) {
      await this.waitUntil(pending, () => !stillPending() || this.deps.quiet());
      if (!stillPending()) return null;
      const attempt = new AbortController();
      pending.stopCheck = () => {
        attempt.abort();
      };
      try {
        const info = await this.deps.readInfo(file);
        if (!stillPending()) return null;
        if (attempt.signal.aborted) continue;
        if (!info.video || info.video.still || !info.durationMs) return { info, sha256: null, bytes: 0 };
        const { sha256, bytes } = await this.deps.hash(file, attempt.signal);
        return { info, sha256, bytes };
      } catch (error) {
        if (!attempt.signal.aborted) throw error;
      } finally {
        pending.stopCheck = undefined;
      }
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
      const checked = await this.checkWhenQuiet(pending, stillPending, unclaimed);
      if (!checked) return;
      const { info, sha256, bytes } = checked;
      if (!info.video || info.video.still || !info.durationMs || sha256 === null) {
        this.deps.notice(
          `The cut of “${row.sourceName}” has no video frames. Choose a longer part and save it again.`,
        );
        return;
      }
      // The show may have started since the finished file was checked. Recheck after every wake,
      // then publish in the same turn, so the live row keeps what it does when the current video ends.
      await this.waitUntil(pending, () => !stillPending() || !this.deps.isLive(row.itemId, row.mediaId));
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
