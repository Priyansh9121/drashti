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
import { clipExportArgs } from './clip-export-plan';
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
}
interface ExportEntry {
  job: ClipExportJob;
  request: ClipExportRequest;
  source: ClipExportSource;
  destination: string;
  conversionId: string | null;
}
const pendingSchema = z
  .array(
    z.object({
      request: clipExportRequestSchema,
      destination: z.string().min(1).max(4096),
      identity: z.string().min(1).max(512),
    }),
  )
  .max(20);

/** Exports outlive the editor. Every decode, encode and validation is conversion's one idle worker. */
export class ClipExports {
  private readonly entries: ExportEntry[] = [];
  private closed = false;
  private resumed = false;
  private closing(): boolean {
    return this.closed;
  }
  constructor(private readonly deps: ClipExportDeps) {}
  list(): ClipExportJob[] {
    return this.entries.map((entry) => ({ ...entry.job }));
  }
  private keep(): boolean {
    if (this.closed) return true;
    try {
      this.deps.kept.save(
        this.entries
          .filter((e) => e.job.state === 'waiting' || e.job.state === 'preparing')
          .map((e) => ({ request: e.request, destination: e.destination, identity: e.source.identity })),
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
  private add(request: ClipExportRequest, source: ClipExportSource, destination: string): ExportEntry {
    if (this.entries.length >= 100) {
      const at = this.entries.findIndex((e) => e.job.state !== 'waiting' && e.job.state !== 'preparing');
      if (at >= 0) this.entries.splice(at, 1);
    }
    const entry: ExportEntry = {
      request,
      source,
      destination,
      conversionId: null,
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
    if (!parsed.success) return;
    for (const saved of parsed.data) {
      const resolved = this.deps.resolve(saved.request);
      if (!resolved.ok || resolved.source.identity !== saved.identity) {
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
        entry.job.message =
          'The video changed while Drashti was closed. Open Export and choose the clip again.';
        continue;
      }
      void this.run(this.add(saved.request, resolved.source, saved.destination));
    }
    this.keep();
  }
  private async run(entry: ExportEntry): Promise<void> {
    const { source, request, job } = entry;
    const info: MediaInfo = { durationMs: source.durationMs, video: null, audio: null };
    const lengthMs = source.outputLengthMs ?? source.endMs - source.startMs;
    const prepared: { info: MediaInfo | null; importId: string | null } = { info: null, importId: null };
    const copy = this.deps.conversions.saveCopy(source.path, entry.destination, info, {
      // Only what plays, the stream or a recording holds an export the operator asked for (alpha.22).
      waitForPlaying: true,
      strictPriority: true,
      kind: 'clip',
      lengthMs,
      inspect: (read) => {
        Object.assign(info, read);
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
              },
              tmp,
            ),
      validate: (read) => {
        if (!read.video || !read.durationMs || Math.abs(read.durationMs - lengthMs) > 250)
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
          prepared.importId = await this.deps.prepareImport(temporary, prepared.info, job.name, signal);
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
    if (this.closed || job.state === 'stopped') return;
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
