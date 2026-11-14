import { lstatSync, realpathSync } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
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

export const trimCopySchema = z.object({ path: z.string().min(1), identity: z.string().min(1) });
const trimCopiesSchema = z.array(trimCopySchema);
type TrimCopy = z.infer<typeof trimCopySchema>;
const TRIM_PART = /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp4$/u;
export const keptTrimSchema = z.object({
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

/** Match the recorded identity to the hidden filename used before a copy is published. */
async function trimParts(mediaDir: string): Promise<Map<string, string | null>> {
  const parts = new Map<string, string | null>();
  for (const entry of await readdir(mediaDir, { withFileTypes: true })) {
    if (!entry.isFile() || !TRIM_PART.test(entry.name)) continue;
    const identity = fileIdentity(join(mediaDir, entry.name));
    if (identity !== null) parts.set(identity, parts.has(identity) ? null : entry.name);
  }
  return parts;
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
  /** The cuts accepted and waiting, and the copies made but not taken in: saved in the background (trim-records.ts). */
  kept: {
    load(): unknown;
    save(cuts: KeptTrim[]): void;
  };
  copies: {
    load(): unknown;
    save(copies: TrimCopy[]): void;
  };
  /** What `kept` and `copies` were given is on the disk when this returns (FT-4); throws when it cannot be written. */
  saveNow(): void;
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
const BEING_MADE = {
  ok: false as const,
  message:
    'This video is already being trimmed. Wait for Preparing to clear, or open Trim again and press Stop.',
};

/** Why a cut accepted before Drashti closed cannot carry on: its row changed, it was never made, or its original. */
type NotResumable = 'row' | 'closed' | 'original';

/** The names, each once, in one list: “A”, “B” and “C”. */
const quotedList = (names: readonly string[]) =>
  new Intl.ListFormat('en').format([...new Set(names.map((name) => `“${name}”`))]);

/**
 * The start notice for the cuts that cannot carry on, with why (TM-3): those Drashti closed before making (a record
 * from before cuts carried on), then those whose original video changed while it was closed.
 */
function notMadeNotice(closed: readonly string[], changed: readonly string[]): string | null {
  const count = closed.length + changed.length;
  if (count === 0) return null;
  const sentences: string[] = [];
  if (closed.length === 1)
    sentences.push(`The cut of ${quotedList(closed)} wasn’t made because Drashti closed.`);
  else if (closed.length > 1)
    sentences.push(`The cuts of ${quotedList(closed)} weren’t made because Drashti closed.`);
  if (changed.length === 1)
    sentences.push(
      `The cut of ${quotedList(changed)} wasn’t made because its original video changed while Drashti was closed.`,
    );
  else if (changed.length > 1)
    sentences.push(
      `The cuts of ${quotedList(changed)} weren’t made because their original videos changed while Drashti was closed.`,
    );
  return `${sentences.join(' ')} Open Trim and save ${count === 1 ? 'it' : 'them'} again.`;
}

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

  /**
   * The rows that say Preparing: a cut being made, or one accepted before Drashti closed and waiting to carry on
   * (TM-1), from the start.
   */
  list(): string[] {
    return [...new Set([...this.pending.keys(), ...this.interrupted.map((cut) => cut.itemId)])];
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

  /**
   * A cut accepted before Drashti closed can carry on: its row, its original and the original's file are as they were.
   * If not, why: its row changed (nothing to name), it is a record from before cuts carried on (Drashti closed before
   * making it), or its original video changed (another file, or the file itself changed or gone).
   */
  private resumable(
    cut: KeptTrim,
  ): { row: TrimSource; request: KeptRequest; mediaDir: string } | NotResumable {
    const row = this.deps.repo.row(cut.itemId);
    if (row?.mediaId !== cut.mediaId) return 'row';
    const request = cut.request;
    if (!request) return 'closed';
    if (row.sourceId !== request.sourceId || row.sourcePath !== request.sourcePath) return 'original';
    try {
      const mediaDir = realpathSync.native(this.deps.mediaDir);
      const source = realpathSync.native(join(mediaDir, row.sourcePath));
      return isInside(mediaDir, source) && fileIdentity(source) === request.sourceIdentity
        ? { row, request, mediaDir }
        : 'original';
    } catch {
      return 'original';
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
      const start = this.resumable(cut);
      if (typeof start === 'string') {
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

  /** A cut accepted before Drashti closed is done with (carried on, made, or not to be): its row's Preparing goes. */
  private removeInterrupted(cut: KeptTrim): void {
    this.interrupted = this.interrupted.filter((record) => record !== cut);
    this.keepWaiting();
    this.deps.pendingChanged(this.list());
  }

  /**
   * The operator's Stop or Reset of a row, once accepted, lets go of that row's cut accepted before Drashti closed
   * (TM-1: never before, so a refused Reset keeps it). Whether there was one.
   */
  private forgetInterrupted(itemId: string): boolean {
    if (!this.interrupted.some((cut) => cut.itemId === itemId)) return false;
    this.interrupted = this.interrupted.filter((cut) => cut.itemId !== itemId);
    this.keepWaiting();
    this.deps.pendingChanged(this.list());
    return true;
  }

  /**
   * The operator reads this once at startup, after the window can show a notice. It waits for no FFmpeg: it names
   * the cuts that cannot carry on, with why (TM-3: Drashti closed before making one, from before cuts carried on, or
   * its original video changed), by the cheap checks alone, and their rows stop saying Preparing; a cut whose row
   * changed goes unnamed. The rest carry on once the start is known.
   */
  reportInterrupted(): string | null {
    this.reported = true;
    const cannot = this.interrupted.flatMap((cut) => {
      const why = this.resumable(cut);
      return typeof why === 'string' ? [{ cut, why }] : [];
    });
    if (cannot.length === 0) return null;
    this.interrupted = this.interrupted.filter((cut) => !cannot.some((record) => record.cut === cut));
    this.keepWaiting();
    this.deps.pendingChanged(this.list());
    const named = (why: NotResumable) =>
      cannot.filter((record) => record.why === why).map(({ cut }) => cut.name);
    return notMadeNotice(named('closed'), named('original'));
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

  /**
   * The operator's Trim of a row. While that row says Preparing (a cut being made, or one accepted before Drashti
   * closed waiting to carry on: TM-1) only a Reset is taken; Stop lets the cut go first.
   */
  async apply(itemId: string, request: RowTrimRequest): Promise<RowTrimResult> {
    return this.applyRequest(itemId, request, true);
  }

  private async applyRequest(
    itemId: string,
    { mediaId, points }: RowTrimRequest,
    byOperator = false,
  ): Promise<RowTrimResult> {
    const row = this.deps.repo.row(itemId);
    if (row?.mediaId !== mediaId || this.closed) return CHANGED;
    const before = this.deps.repo.view(itemId);
    if (!before) return CHANGED;
    if (points.startMs === null && points.endMs === null && before.canReset)
      return this.resetRow(row, resetMarkerEdits(before.markers, points));
    if (this.pending.has(itemId) || (byOperator && this.interrupted.some((cut) => cut.itemId === itemId)))
      return BEING_MADE;
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

  /** Stop: the row's cut being made stops, or its cut waiting to carry on after a restart is let go (TM-1). */
  stop(itemId: string, mediaId: string): RowTrimResult {
    const row = this.deps.repo.row(itemId);
    if (this.closed || row?.mediaId !== mediaId) return CHANGED;
    const waiting = this.forgetInterrupted(itemId);
    if (!this.cancelPending(itemId) && !waiting)
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
    // Accepted: the row plays its original again, so its cut waiting to carry on goes too (TM-1), and any being made.
    this.forgetInterrupted(row.itemId);
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

  /**
   * The cut's records are on the disk before ConvertService publishes it (saveNow, FT-4): a crash just after can never
   * leave it in Media with no record. If they cannot be written, it is not published.
   */
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
    this.deps.saveNow();
  }

  /**
   * The files in Media that Trim's records hold (FT-8), by their paths in the media folder: each copy made and not yet
   * taken in (being made, finished, or waiting to carry on after a restart) and each such cut's original. The unused
   * cuts sweep never moves one.
   */
  heldFiles(): Set<string> {
    const held = new Set<string>();
    const hold = (cut: KeptTrim | null | undefined) => {
      if (cut?.copy) held.add(cut.copy.path);
      if (cut?.request) held.add(cut.request.sourcePath);
    };
    for (const copy of this.copies) held.add(copy.path);
    for (const pending of this.pending.values()) {
      if (pending.copy) held.add(pending.copy.path);
      hold(pending.kept);
    }
    for (const cut of this.interrupted) hold(cut);
    return held;
  }

  /** Retry cleanup for copies left without a current accepted Trim. */
  async cleanupCopies(): Promise<void> {
    const active = new Set([...this.pending.values()].map((pending) => pending.copy));
    let parts: Map<string, string | null> | undefined;
    for (const copy of [...this.copies]) {
      if (active.has(copy)) continue;
      await this.discardCopy(copy, async (mediaDir) => {
        parts ??= await trimParts(mediaDir);
        return parts.get(copy.identity) ?? null;
      });
    }
  }

  private copyPath(mediaDir: string, copy: TrimCopy): string | null {
    const candidate = resolve(mediaDir, copy.path);
    if (!isInside(mediaDir, candidate) || fileIdentity(candidate) !== copy.identity) return null;
    const real = realpathSync.native(candidate);
    return isInside(mediaDir, real) && relative(mediaDir, real).split(sep).join('/') === copy.path
      ? real
      : null;
  }

  private async discardCopy(
    copy: TrimCopy,
    findPart?: (mediaDir: string) => Promise<string | null>,
  ): Promise<void> {
    try {
      const mediaDir = realpathSync.native(this.deps.mediaDir);
      let relativePath = copy.path;
      let path = this.copyPath(mediaDir, copy);
      if (!path && findPart) {
        const part = await findPart(mediaDir);
        if (part !== null) {
          relativePath = part;
          path = this.copyPath(mediaDir, { path: part, identity: copy.identity });
        }
      }
      if (path && !this.deps.repo.referencesFile(relativePath, path)) await this.deps.trash(path);
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
