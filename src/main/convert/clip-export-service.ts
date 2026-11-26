import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import {
  clipExportRequestSchema,
  type ClipExportJob,
  type ClipExportRequest,
  type ClipExportResult,
} from '../../shared/video-copies';
import { safeName } from '../links/names';
import { JOINED_PARTS_ORIGINAL, clipPartsLength } from '../../shared/clip-parts';
import { clipExportArgs } from './clip-export-plan';
import { frameFacts } from './combine-plan';
import { hasAlpha, type MediaInfo } from './plan';
import type { ConvertService } from './convert-service';

export interface ClipExportSource {
  path: string;
  name: string;
  mediaId: string;
  sha256: string;
  /** Supplied only by S2’s committed pure planner, using the original source and captured recipe. */
  args?: (info: MediaInfo, output: string) => string[];
  outputLengthMs?: number;
  /** Immutable selected rendition + source identity; a proxy is never an export source. */
  identity: string;
  durationMs: number | null;
  /** Source-time request mapped once into this selected rendition's time. */
  startMs: number;
  endMs: number;
}
export type ExportSourceResult = { ok: true; source: ClipExportSource } | { ok: false; message: string };
export interface ClipExportDeps {
  resolve(request: ClipExportRequest): ExportSourceResult;
  /** Re-check the selected immutable source, not the library's newest edit revision. */
  current(source: ClipExportSource): boolean;
  pickDest(name: string, container: 'mp4' | 'webm'): Promise<string | null>;
  conversions: Pick<ConvertService, 'saveCopy' | 'cancelFile'>;
  kept: { load(): unknown; save(pending: unknown): void };
  prepareImport(file: string, info: MediaInfo, name: string, signal: AbortSignal): Promise<string>;
  publishImport(mediaId: string): Promise<boolean>;
  /**
   * What prepareImport copied into Media from `file` (this export's own temporary file) and never listed, removed with
   * its file in Media; `keep` (rows live exports hold) stays; nothing goes unless `allowed` says so (null: left for
   * later) (a22-exportclip, by a22-review-combine2's rules).
   */
  discardUnlisted(
    files: readonly string[],
    keep: ReadonlySet<string>,
    allowed: () => boolean,
  ): Promise<unknown>;
  /**
   * Nothing plays, off air, not recording, and no import or deck preparation going (a22-review-combine2 R-S1, R-S2):
   * only then is anything unlisted removed.
   */
  quiet(): boolean;
  /** The temporary files whose copies into Media are still to be removed, kept across a restart. */
  left: { load(): unknown; save(files: unknown): void };
  /** How many copies into Media made from `file`, never listed, are still there. */
  leftFrom(file: string): number;
}
interface ExportEntry {
  job: ClipExportJob;
  request: ClipExportRequest;
  source: ClipExportSource;
  destination: string;
  conversionId: string | null;
  /**
   * Also add the clip to Media: the temporary file its copy into Media was made from, kept with the request until what
   * was not listed is removed, so a quit or a crash at that moment is cleared at the next start (a22-exportclip).
   */
  made: string | null;
}
const pendingSchema = z
  .array(
    z.object({
      request: clipExportRequestSchema,
      destination: z.string().min(1).max(4096),
      identity: z.string().min(1).max(512),
      made: z.string().min(1).max(4096).optional(),
    }),
  )
  .max(20);

/** Exports outlive the editor. Every decode, encode and validation is conversion's one idle worker. */
export class ClipExports {
  private readonly entries: ExportEntry[] = [];
  private closed = false;
  private resumed = false;
  /** Copies into Media going now (a copy of the same bytes takes up an earlier leftover's row): nothing is removed. */
  private copying = 0;
  /** The rows live exports hold (copied into Media, not listed yet): never removed. */
  private readonly holding = new Set<string>();
  /** Temporary files whose copies into Media (never listed) are still to go, at a quiet moment or a later start. */
  private readonly unclean = new Set<string>();
  /** How many the list of what is left keeps: the newest, the oldest going first past it (a22-combineleaks). */
  private static readonly LEFT_MOST = 1000;
  private closing(): boolean {
    return this.closed;
  }
  constructor(private readonly deps: ClipExportDeps) {
    // Each entry on its own: one that is not a path is skipped, a list past the cap keeps its newest (never dropped whole).
    const loaded = z.array(z.unknown()).safeParse(deps.left.load());
    const files = loaded.success
      ? loaded.data.filter(
          (file): file is string => typeof file === 'string' && file.length > 0 && file.length <= 4096,
        )
      : [];
    for (const file of files.slice(-ClipExports.LEFT_MOST)) this.unclean.add(file);
  }
  /** The request no longer names `made` (it is in the list of what is left now). */
  private forget(entry: ExportEntry, made: string): void {
    if (entry.made === made) entry.made = null;
  }
  /** Whether what an export left in Media may be removed now; when in doubt, it is left for a later start. */
  private allowed(): boolean {
    if (this.closed || this.copying > 0) return false;
    try {
      return this.deps.quiet();
    } catch {
      return false;
    }
  }
  private saveLeft(): void {
    try {
      this.deps.left.save([...this.unclean].slice(-ClipExports.LEFT_MOST));
    } catch {
      /* Kept in memory; the request list still names a file whose request is kept. */
    }
  }
  /**
   * What exports copied into Media from these files and never listed: kept in the list of what is left, removed now if
   * they may be, in ONE pass (one library-wide scan however many: a22-combineleaks), the list forgetting each once
   * nothing of it is left; else at a later start. Never throws.
   */
  private async removeLeft(files: readonly string[]): Promise<void> {
    if (files.length === 0) return;
    for (const made of files) this.unclean.add(made);
    this.saveLeft();
    let done: unknown;
    try {
      done = await this.deps.discardUnlisted(files, new Set(this.holding), () => this.allowed());
    } catch {
      done = null;
    }
    // Forgotten only once nothing of it is left: a copy kept only for now (its file still held on Windows, its row
    // taken up by its bytes in this run) or used stays in the list, and a later start tries it again
    // (a22-review-combine2 L-E1). When in doubt, it stays.
    if (done === null || done === undefined) return;
    for (const made of files) {
      let left: number;
      try {
        left = this.deps.leftFrom(made);
      } catch {
        left = 1;
      }
      if (left === 0) this.unclean.delete(made);
    }
    this.saveLeft();
  }
  list(): ClipExportJob[] {
    return this.entries.map((entry) => ({ ...entry.job }));
  }
  private keep(): boolean {
    if (this.closed) return true;
    try {
      this.deps.kept.save(
        this.entries
          .filter((e) => e.job.state === 'waiting' || e.job.state === 'preparing')
          .map((e) => ({
            request: e.request,
            destination: e.destination,
            identity: e.source.identity,
            ...(e.made === null ? {} : { made: e.made }),
          })),
      );
      return true;
    } catch {
      return false;
    }
  }
  async start(raw: unknown): Promise<ClipExportResult> {
    if (this.closing()) return { ok: false, message: 'Drashti is closing. Try exporting after restarting.' };
    const parsed = clipExportRequestSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, message: 'Choose a start and end inside the video, then try Export again.' };
    if (this.entries.filter((e) => e.job.state === 'waiting' || e.job.state === 'preparing').length >= 20)
      return {
        ok: false,
        message: 'Many clips are waiting. Let some finish or stop one, then export again.',
      };
    // Saved edits cover Start and End only: joined parts come from the original (alpha.24).
    if (parsed.data.parts && parsed.data.frame === 'edited')
      return { ok: false, message: JOINED_PARTS_ORIGINAL };
    const resolved = this.deps.resolve(parsed.data);
    if (!resolved.ok) return resolved;
    const title = basename(safeName(resolved.source.name, 'Video'), extname(resolved.source.name));
    const destination = await this.deps.pickDest(
      `${title} clip.${parsed.data.container}`,
      parsed.data.container,
    );
    if (destination === null) return { ok: true, job: null };
    if (this.closing() || !this.deps.current(resolved.source))
      return { ok: false, message: 'The video changed while Save as was open. Open Export again.' };
    const entry = this.add(parsed.data, resolved.source, destination);
    if (!this.keep()) {
      this.entries.splice(this.entries.indexOf(entry), 1);
      return {
        ok: false,
        message: 'Drashti could not keep this export request. Check free disk space, then try again.',
      };
    }
    void this.run(entry);
    return { ok: true, job: { ...entry.job } };
  }
  private add(
    request: ClipExportRequest,
    source: ClipExportSource,
    destination: string,
    made: string | null = null,
  ): ExportEntry {
    if (this.entries.length >= 100) {
      const at = this.entries.findIndex((e) => e.job.state !== 'waiting' && e.job.state !== 'preparing');
      if (at >= 0) this.entries.splice(at, 1);
    }
    const entry: ExportEntry = {
      request,
      source,
      destination,
      conversionId: null,
      made,
      job: {
        id: randomUUID(),
        mediaId: request.mediaId,
        name: basename(destination),
        state: 'waiting',
        progress: null,
        note: 'Waiting for an idle moment.',
        message: null,
        path: null,
        added: false,
      },
    };
    this.entries.push(entry);
    return entry;
  }
  resume(): void {
    if (this.closed || this.resumed) return;
    this.resumed = true;
    const parsed = pendingSchema.safeParse(this.deps.kept.load());
    const requests = parsed.success ? parsed.data : [];
    // What earlier runs left (their requests ended, or the request list unreadable), and what a request refused below
    // left: removed now if it may be, in one pass. A kept request's own file goes as it runs again.
    const earlier = [...this.unclean].filter((file) => !requests.some((saved) => saved.made === file));
    if (!parsed.success) {
      void this.removeLeft(earlier);
      return;
    }
    for (const saved of parsed.data) {
      const joinedEdited = saved.request.parts !== undefined && saved.request.frame === 'edited';
      const resolved = joinedEdited ? null : this.deps.resolve(saved.request);
      if (!resolved?.ok || resolved.source.identity !== saved.identity) {
        // What a quit left of it in Media (copied, never listed) goes too, when it may.
        if (saved.made) earlier.push(saved.made);
        const source: ClipExportSource = {
          path: '',
          mediaId: saved.request.mediaId,
          sha256: '',
          name: basename(saved.destination),
          identity: saved.identity,
          durationMs: null,
          startMs: 0,
          endMs: 0,
        };
        const entry = this.add(saved.request, source, saved.destination);
        entry.job.state = 'failed';
        entry.job.note = null;
        entry.job.message = joinedEdited
          ? JOINED_PARTS_ORIGINAL
          : 'The video changed while Drashti was closed. Open Export and choose the clip again.';
        continue;
      }
      void this.run(this.add(saved.request, resolved.source, saved.destination, saved.made ?? null));
    }
    void this.removeLeft(earlier);
    this.keep();
  }
  private async run(entry: ExportEntry): Promise<void> {
    const { source, request, job } = entry;
    // Kept from before a quit or a crash: what its copy into Media left (never listed) goes before it exports again.
    if (entry.made !== null) {
      // Into the list of what is left first, so the request can forget it.
      const left = entry.made;
      const removing = this.removeLeft([left]);
      entry.made = null;
      this.keep();
      await removing;
      if (this.closed || job.state === 'stopped') return;
    }
    const info: MediaInfo = { durationMs: source.durationMs, video: null, audio: null };
    // Joined parts (alpha.24) are the original's (start refuses Saved edits with them), in its own time.
    const parts = request.parts;
    const lengthMs =
      source.outputLengthMs ?? (parts ? clipPartsLength(parts) : source.endMs - source.startMs);
    /**
     * How far the new clip's length may be from the one expected: as before for one part; joined, each further part may
     * add one frame of the source's (its picture's last frame running to the frame after the part's end, its sound
     * padded to match at the join, so the two stay together), learnt from FFmpeg's words as it is read.
     */
    let lengthSlackMs = 250;
    const prepared: { info: MediaInfo | null; importId: string | null; temporary: string | null } = {
      info: null,
      importId: null,
      temporary: null,
    };
    const copy = this.deps.conversions.saveCopy(source.path, entry.destination, info, {
      // Only what plays, the stream or a recording holds an export the operator asked for (alpha.22).
      waitForPlaying: true,
      strictPriority: true,
      kind: 'clip',
      lengthMs,
      inspect: (read, words) => {
        Object.assign(info, read);
        if (parts) {
          const [top = 0, bottom = 1] = (frameFacts(words.words).rate ?? '10').split('/').map(Number);
          const frameMs = top > 0 && bottom > 0 ? (1000 * bottom) / top : 100;
          lengthSlackMs = 250 + (parts.length - 1) * frameMs;
        }
        if (!read.durationMs || source.startMs < 0 || source.endMs > read.durationMs || lengthMs <= 0)
          return 'The selected part is outside this video. Choose its start and end again.';
        if (hasAlpha(read) && request.container === 'mp4')
          return 'This video has transparency. Choose WebM to keep it, then Export again.';
        return undefined;
      },
      args: (tmp) =>
        source.args
          ? source.args(info, tmp)
          : clipExportArgs(
              {
                source: source.path,
                startMs: source.startMs,
                endMs: source.endMs,
                shape: request.shape,
                info,
                container: request.container,
                ...(parts ? { parts } : {}),
              },
              tmp,
            ),
      validate: (read) => {
        if (!read.video || !read.durationMs || Math.abs(read.durationMs - lengthMs) > lengthSlackMs)
          return 'The exported clip did not have the expected length. Check the selected times, then try Export again.';
        if (request.shape === 'vertical' && (read.video.width !== 1080 || read.video.height !== 1920))
          return 'The vertical clip did not have the expected picture size. Try Export again.';
        if (hasAlpha(info) && !hasAlpha(read))
          return 'The exported clip lost its transparency. Choose WebM and try Export again.';
        prepared.info = read;
        return undefined;
      },
      preparePublish: async (temporary, signal) => {
        if (request.addToLibrary) {
          if (!prepared.info) throw new Error('The exported clip was not validated.');
          // Kept with the request first: a quit or a crash during or after the copy is cleared at the next start.
          prepared.temporary = temporary;
          entry.made = temporary;
          this.keep();
          this.copying += 1;
          try {
            prepared.importId = await this.deps.prepareImport(temporary, prepared.info, job.name, signal);
            this.holding.add(prepared.importId);
          } finally {
            this.copying -= 1;
          }
        }
      },
      beforePublish: () => {
        if (!this.deps.current(source)) throw new Error('Source changed.');
      },
      waiting: (note) => {
        job.note = note;
        job.state = note ? 'waiting' : 'preparing';
      },
      progress: (fraction) => {
        job.progress = fraction;
        if (!job.note) job.state = 'preparing';
      },
    });
    entry.conversionId = copy.id;
    job.note = job.note === 'Waiting for an idle moment.' ? null : job.note;
    const result = await copy.done;
    entry.conversionId = null;
    const going = !this.closed && job.state !== 'stopped';
    if (going) {
      job.note = null;
      if (!result.ok || !result.copy) {
        job.state = result.ok ? 'failed' : result.stopped ? 'stopped' : 'failed';
        job.message = result.ok ? 'The clip was not kept. Open Export and try again.' : result.message;
      } else {
        job.state = 'done';
        job.progress = 1;
        job.path = result.copy;
        job.name = basename(result.copy);
        if (request.addToLibrary) {
          try {
            job.added = prepared.importId !== null && (await this.deps.publishImport(prepared.importId));
          } catch {
            job.added = false;
          }
          if (!job.added)
            job.message =
              'The clip was saved, but could not be added to Media. Use Import to add the saved file.';
        }
      }
    }
    // What it copied into Media and did not list goes, with its file there: failing, stopped or let go of late, it leaves
    // nothing in Media (the saved file is the operator's own). A video already in Media is never touched (a22-exportclip).
    if (prepared.importId !== null) this.holding.delete(prepared.importId);
    if (prepared.temporary !== null) {
      // Into the list of what is left before the request forgets it; once listed, nothing waits for it.
      const removing = this.removeLeft([prepared.temporary]);
      this.forget(entry, prepared.temporary);
      if (!job.added) await removing;
    }
    if (!going) return;
    if (!this.keep() && job.state === 'done')
      job.message =
        'The clip was saved, but its request could not be cleared. Show the file before closing Drashti.';
  }
  stop(id: string): boolean {
    const entry = this.entries.find(
      (e) => e.job.id === id && (e.job.state === 'waiting' || e.job.state === 'preparing'),
    );
    if (!entry) return false;
    entry.job.state = 'stopped';
    entry.job.note = null;
    if (entry.conversionId) this.deps.conversions.cancelFile(entry.conversionId);
    this.keep();
    return true;
  }
  close(): void {
    this.keep();
    this.closed = true;
    for (const entry of this.entries)
      if (entry.conversionId) this.deps.conversions.cancelFile(entry.conversionId);
  }
}
