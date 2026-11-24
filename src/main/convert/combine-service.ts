import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  combineRequestSchema,
  COMBINE_MOST,
  type CombineJob,
  type CombineResult,
  type ExportCopyResult,
} from '../../shared/video-copies';
import type { DetailsRow } from '../media/media-details';
import {
  combinedName,
  combineJoins,
  combinePlan,
  type CombineChoice,
  type CombinePlan,
} from './combine-plan';
import { copyToChosen } from './export-copy';
import type { ConvertService, CopyOptions } from './convert-service';
import type { MediaInfo } from './plan';

/*
 * Combine videos… (alpha.22; the owner, 24 Nov 2026: "new feature, combine 2 videos", "Yes, one after other"): the
 * chosen videos, in the operator's order, joined end to end into ONE new video added to Media. It runs as Edit Video's
 * export does, in conversion's one idle worker: at the lowest priority (verified, else refused), waiting while the
 * show, stream or recording is on (and starting again from the beginning when one starts while it runs), with its
 * progress and Stop. The originals are only read: the new video is made in a work folder of its own, checked (its
 * picture, sound and length), copied into Media and listed only then. A combine waiting or going when Drashti quits is
 * let go of (nothing of it is left); combine them again after the restart.
 */
export interface CombineSource {
  mediaId: string;
  name: string;
  path: string;
  sha256: string;
}
export interface CombineDeps {
  mediaDir: string;
  /** Where the new video is made, before it is copied into Media (emptied at the start). */
  workDir: string;
  row(
    mediaId: string,
  ): Pick<DetailsRow, 'name' | 'kind' | 'path' | 'sha256' | 'missing' | 'deleted' | 'durationMs'> | null;
  conversions: Pick<ConvertService, 'saveCopy' | 'cancelFile'>;
  idle(): boolean;
  /** Copy the checked file into Media as a new video, not listed yet: its media id. */
  prepareImport(file: string, info: MediaInfo, name: string, signal: AbortSignal): Promise<string>;
  /** List it in Media. */
  publishImport(mediaId: string): Promise<boolean>;
  /**
   * The system's save dialog, offering Downloads and `name` (Also save a copy to a file, and Export…): the file chosen,
   * or null when cancelled. The system's own dialog asks before replacing a file there.
   */
  pickCopy(name: string): Promise<string | null>;
  freeBytes(dir: string): number;
}
interface Entry {
  job: CombineJob;
  sources: CombineSource[];
  conversionId: string | null;
  /** Also save a copy to a file: where, chosen before it combined. */
  copyTo: string | null;
}
/** How many combines may wait at once. */
const WAITING_MOST = 5;

export class CombineVideos {
  private readonly entries: Entry[] = [];
  private closed = false;
  constructor(private readonly deps: CombineDeps) {
    rmSync(deps.workDir, { recursive: true, force: true });
    mkdirSync(deps.workDir, { recursive: true });
  }
  /** Read afresh after an await (the save dialog): Drashti may have started closing meanwhile. */
  private closing(): boolean {
    return this.closed;
  }
  list(): CombineJob[] {
    return this.entries.map((entry) => this.told(entry));
  }
  private told(entry: Entry): CombineJob {
    return { ...entry.job, mediaIds: [...entry.job.mediaIds], short: [...entry.job.short] };
  }
  /** Each chosen video as Media holds it now, or why it cannot be combined. */
  private resolve(mediaId: string): CombineSource | string {
    const row = this.deps.row(mediaId);
    if (!row || row.deleted) return 'One of the chosen videos is no longer in Media. Choose them again.';
    if (row.kind !== 'video') return `“${row.name}” is not a video. Choose videos only, then Combine.`;
    if (row.missing || !row.sha256 || !row.path)
      return `“${row.name}”’s file is missing. Restore it, then Combine again.`;
    const path = join(this.deps.mediaDir, row.path);
    if (!existsSync(path)) return `“${row.name}”’s file is missing. Restore it, then Combine again.`;
    return { mediaId, name: row.name, path, sha256: row.sha256 };
  }
  /** Whether each chosen video is still the very file it was when its combine was asked for. */
  private current(sources: readonly CombineSource[]): boolean {
    return sources.every((source) => {
      const now = this.resolve(source.mediaId);
      return typeof now !== 'string' && now.path === source.path && now.sha256 === source.sha256;
    });
  }
  async start(raw: unknown): Promise<CombineResult> {
    if (this.closed)
      return { ok: false, message: 'Drashti is closing. Combine the videos after restarting.' };
    const parsed = combineRequestSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message: `Choose two or more videos (at most ${String(COMBINE_MOST)}), each once, and a transition of 0.5 to 3 seconds, then Combine.`,
      };
    if (
      this.entries.filter((e) => e.job.state === 'waiting' || e.job.state === 'preparing').length >=
      WAITING_MOST
    )
      return {
        ok: false,
        message: 'Several combines are waiting. Let one finish or stop one, then Combine again.',
      };
    const sources: CombineSource[] = [];
    for (const id of parsed.data.mediaIds) {
      const source = this.resolve(id);
      if (typeof source === 'string') return { ok: false, message: source };
      sources.push(source);
    }
    const request = parsed.data;
    const choice = { transition: request.transition, transitionMs: request.transitionMs };
    const known = combineJoins(
      request.mediaIds.map((id) => this.deps.row(id)?.durationMs ?? 0),
      choice,
    );
    const name = combinedName(sources.map((s) => s.name));
    // Also save a copy to a file: chosen now, before anything is made (cancelled: nothing is).
    let copyTo: string | null = null;
    if (request.saveCopy) {
      copyTo = await this.deps.pickCopy(name);
      if (copyTo === null) return { ok: true, job: null };
      if (this.closing() || !this.current(sources))
        return { ok: false, message: 'The videos changed while the save dialog was open. Combine again.' };
    }
    const entry: Entry = {
      sources,
      conversionId: null,
      copyTo,
      job: {
        id: randomUUID(),
        name,
        mediaIds: [...request.mediaIds],
        transition: request.transition,
        transitionMs: request.transitionMs,
        short: known.short.map((at) => sources[at]?.name ?? ''),
        state: 'waiting',
        progress: null,
        note: 'Waiting for an idle moment.',
        message: null,
        mediaId: null,
        savedTo: null,
      },
    };
    if (this.entries.length >= 50) {
      const at = this.entries.findIndex((e) => e.job.state !== 'waiting' && e.job.state !== 'preparing');
      if (at >= 0) this.entries.splice(at, 1);
    }
    this.entries.push(entry);
    void this.run(entry, choice, known.lengthMs);
    return { ok: true, job: this.told(entry) };
  }
  private async run(entry: Entry, choice: CombineChoice, knownMs: number): Promise<void> {
    const { job, sources } = entry;
    const [first, ...rest] = sources;
    if (!first) return;
    const info: MediaInfo = { durationMs: null, video: null, audio: null };
    const made: { plan: CombinePlan | null; info: MediaInfo | null; importId: string | null } = {
      plan: null,
      info: null,
      importId: null,
    };
    // The new file is new: its size is about the chosen ones' together (reserved half as much again).
    const bytes = sources.reduce(
      (sum, s) => sum + (statSync(s.path, { throwIfNoEntry: false })?.size ?? 0),
      0,
    );
    const options: CopyOptions = {
      waitForShow: true,
      strictPriority: true,
      kind: 'clip',
      // Its progress and its time limit (four times its length, and 5 minutes more) by all of them together, as Media
      // knows them and then as the worker read them.
      lengthMs: knownMs,
      estimatedBytes: Math.ceil(bytes * 1.5),
      alsoRead: rest.map((s) => s.path),
      inspect: (read, words) => {
        Object.assign(info, read);
        if (!this.current(sources))
          return 'One of the videos changed in Media. Choose them again, then Combine.';
        if (words.more.length !== rest.length) return 'Drashti could not read every chosen video. Try again.';
        try {
          made.plan = combinePlan(
            [
              { file: first.path, info: read, words: words.words },
              ...rest.map((s, at) => ({
                file: s.path,
                info: words.more[at]?.info ?? { durationMs: null, video: null, audio: null },
                words: words.more[at]?.words ?? '',
              })),
            ],
            choice,
          );
          options.lengthMs = Math.max(knownMs, made.plan.lengthMs);
        } catch (error) {
          return error instanceof Error
            ? error.message
            : 'These videos cannot be combined. Check them, then try again.';
        }
        return undefined;
      },
      args: (temporary) => {
        if (!made.plan) throw new Error('The videos have not been read by the idle worker.');
        return made.plan.args(temporary);
      },
      validate: (read) => {
        const plan = made.plan;
        if (
          !plan ||
          !read.video ||
          !read.audio ||
          !read.durationMs ||
          Math.abs(read.durationMs - plan.lengthMs) > 250 ||
          read.video.width !== plan.width ||
          read.video.height !== plan.height
        )
          return 'The combined video did not have the expected picture, sound or length. Check the videos, then Combine again.';
        made.info = read;
        return undefined;
      },
      preparePublish: async (temporary, signal) => {
        if (!made.info || !this.current(sources) || !this.deps.idle())
          throw new Error('The combined video is no longer ready to keep.');
        made.importId = await this.deps.prepareImport(temporary, made.info, job.name, signal);
      },
      beforePublish: () => {
        if (!this.current(sources)) throw new Error('A chosen video changed.');
      },
      waiting: (note) => {
        if (job.state !== 'waiting' && job.state !== 'preparing') return;
        job.note = note;
        job.state = note ? 'waiting' : 'preparing';
      },
      progress: (fraction) => {
        if (job.state !== 'waiting' && job.state !== 'preparing') return;
        job.progress = fraction;
        if (!job.note) job.state = 'preparing';
      },
    };
    const copy = this.deps.conversions.saveCopy(
      first.path,
      join(this.deps.workDir, `${job.id}.mp4`),
      info,
      options,
    );
    entry.conversionId = copy.id;
    if (job.note === 'Waiting for an idle moment.') job.note = null;
    const result = await copy.done;
    entry.conversionId = null;
    // The work file is only a step: Media keeps its own copy.
    if (result.ok && result.copy) rmSync(result.copy, { force: true });
    if (this.closed || job.state === 'stopped') return;
    job.note = null;
    if (!result.ok || !result.copy) {
      job.state = result.ok ? 'failed' : result.stopped ? 'stopped' : 'failed';
      job.message = result.ok ? 'The combined video was not kept. Try Combine again.' : result.message;
      return;
    }
    const listed =
      made.importId !== null && (await this.deps.publishImport(made.importId).catch(() => false));
    if (!listed) {
      job.state = 'failed';
      job.message =
        'The combined video could not be added to Media. Check free disk space, then Combine again.';
      return;
    }
    job.progress = 1;
    job.mediaId = made.importId;
    // Also save a copy to a file: Media's new copy copied there, never encoded again.
    if (entry.copyTo) {
      job.note = 'Saving a copy to the file chosen…';
      const saved = await this.copyOut(made.importId, entry.copyTo);
      job.note = null;
      if (saved.ok) job.savedTo = saved.path;
      else
        job.message = `Added to Media, but the copy could not be saved: ${saved.message} Use Export… to try again.`;
    }
    job.state = 'done';
  }
  /** Media's own copy of a finished combine copied to `dest`, whole or not at all, only while idle. */
  private copyOut(mediaId: string | null, dest: string): Promise<ExportCopyResult> {
    const row = mediaId ? this.deps.row(mediaId) : null;
    if (!row || row.deleted || row.missing || !row.path)
      return Promise.resolve({
        ok: false,
        message: 'The combined video is no longer in Media. Combine the videos again.',
      });
    return copyToChosen(join(this.deps.mediaDir, row.path), dest, {
      idle: () => this.deps.idle(),
      freeBytes: (dir) => this.deps.freeBytes(dir),
    });
  }
  /** Export…: a finished combine's video saved to a file chosen in the system's save dialog (Downloads, its name). */
  async exportCopy(id: string): Promise<ExportCopyResult> {
    const entry = this.entries.find((e) => e.job.id === id && e.job.state === 'done' && e.job.mediaId);
    if (!entry) return { ok: false, message: 'That combined video is not ready. Combine the videos again.' };
    if (!this.deps.idle())
      return {
        ok: false,
        message:
          'Export… waits for an idle moment: nothing can be exported while anything is up, streaming or recording. Try again when the show is idle.',
      };
    const dest = await this.deps.pickCopy(entry.job.name);
    if (dest === null) return { ok: true, path: null };
    return this.copyOut(entry.job.mediaId, dest);
  }
  stop(id: string): boolean {
    const entry = this.entries.find(
      (e) => e.job.id === id && (e.job.state === 'waiting' || e.job.state === 'preparing'),
    );
    if (!entry) return false;
    entry.job.state = 'stopped';
    entry.job.note = null;
    entry.job.message = 'Stopped. Nothing was added to Media.';
    if (entry.conversionId) this.deps.conversions.cancelFile(entry.conversionId);
    return true;
  }
  close(): void {
    this.closed = true;
    for (const entry of this.entries)
      if (entry.conversionId) this.deps.conversions.cancelFile(entry.conversionId);
  }
}
