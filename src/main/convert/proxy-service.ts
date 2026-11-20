import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { VideoProxy, VideoProxyResult } from '../../shared/video-copies';
import type { DetailsRow } from '../media/media-details';
import type { ConvertService } from './convert-service';
import { hasAlpha, type MediaInfo } from './plan';
import { proxyArgs, proxyPlan, type ProxyComputer } from './proxy-plan';

const keptSchema = z
  .array(
    z.object({
      mediaId: z.string().min(1).max(128),
      sha: z.string().regex(/^[a-f0-9]{64}$/u),
      required: z.boolean(),
      readyId: z.string().max(128).nullable(),
      copySha: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .nullable(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
      stopped: z.boolean(),
    }),
  )
  .max(10_000);
interface ProxyEntry {
  sha: string;
  snapshot: VideoProxy;
  copySha: string | null;
  job: string | null;
  file: string | null;
  info: MediaInfo | null;
  controller: AbortController | null;
}
export interface ProxyDeps {
  mediaDir: string;
  row(mediaId: string): DetailsRow | null;
  sourceIds(): string[];
  computer(): ProxyComputer;
  idle(): boolean;
  conversions: Pick<ConvertService, 'saveCopy' | 'cancelFile'>;
  /** A validated copy is hashed off Main and registered as unlisted immutable media, only while idle. */
  register(file: string, info: MediaInfo, signal: AbortSignal): Promise<string>;
  kept: { load(): unknown; save(value: unknown): void };
}

/** Automatic copies are speculative until the idle header read establishes that this source is oversized. */
export class ProxyService {
  private readonly entries = new Map<string, ProxyEntry>();
  private readonly work: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private working = false;
  private closed = false;
  constructor(private readonly deps: ProxyDeps) {
    this.work = join(deps.mediaDir, 'video-proxy-work');
    // Only unpublished intermediates live here; registered immutable files live in the hash-named media folders.
    rmSync(this.work, { recursive: true, force: true });
    mkdirSync(this.work, { recursive: true });
    const kept = keptSchema.safeParse(deps.kept.load());
    if (kept.success)
      for (const saved of kept.data) {
        const row = deps.row(saved.mediaId);
        if (row?.sha256 !== saved.sha || row.deleted || row.missing) continue;
        const entry = this.newEntry(saved.mediaId, saved.sha);
        Object.assign(entry.snapshot, {
          required: saved.required,
          readyMediaId: saved.readyId,
          width: saved.width,
          height: saved.height,
          state: saved.stopped
            ? 'stopped'
            : saved.readyId
              ? saved.required
                ? 'ready'
                : 'not-needed'
              : 'waiting',
        });
        entry.copySha = saved.copySha;
        this.entries.set(saved.mediaId, entry);
      }
  }
  resume(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      void this.step();
    }, 1000);
    this.timer.unref();
    void this.step();
  }
  private slow(): boolean {
    const computer = this.deps.computer();
    return computer.softwareVideo || (computer.logicalCores > 0 && computer.logicalCores <= 2);
  }
  private newEntry(mediaId: string, sha: string): ProxyEntry {
    return {
      sha,
      copySha: null,
      job: null,
      file: null,
      info: null,
      controller: null,
      snapshot: {
        mediaId,
        state: 'checking',
        required: false,
        readyMediaId: mediaId,
        progress: null,
        width: null,
        height: null,
        note: 'Checks this video while idle.',
        message: null,
      },
    };
  }
  private keep(): boolean {
    if (this.closed) return true;
    try {
      this.deps.kept.save(
        [...this.entries.values()].map((entry) => ({
          mediaId: entry.snapshot.mediaId,
          sha: entry.sha,
          required: entry.snapshot.required,
          readyId:
            entry.snapshot.state === 'ready' || entry.snapshot.state === 'not-needed'
              ? entry.snapshot.readyMediaId
              : null,
          copySha: entry.copySha,
          width: entry.snapshot.width,
          height: entry.snapshot.height,
          stopped: entry.snapshot.state === 'stopped',
        })),
      );
      return true;
    } catch {
      return false;
    }
  }
  private available(row: DetailsRow | null): row is DetailsRow {
    return (
      !!row &&
      !row.deleted &&
      !row.missing &&
      row.kind === 'video' &&
      !!row.sha256 &&
      existsSync(join(this.deps.mediaDir, row.path))
    );
  }
  get(mediaId: string, retry = false): VideoProxyResult {
    const row = this.deps.row(mediaId);
    if (!this.available(row) || row.playable === false)
      return {
        ok: false,
        message: 'This video’s file is unavailable or still converting. Check Media before trying again.',
      };
    if (!this.slow())
      return {
        ok: true,
        proxy: { ...this.newEntry(mediaId, row.sha256 ?? '').snapshot, state: 'not-needed', note: null },
      };
    let entry = this.entries.get(mediaId);
    if (entry && entry.sha !== row.sha256) {
      this.stop(mediaId);
      this.entries.delete(mediaId);
      entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= 10_000)
        return {
          ok: false,
          message: 'Many videos have been checked. Restart Drashti before preparing more lighter copies.',
        };
      entry = this.newEntry(mediaId, row.sha256 ?? '');
      this.entries.set(mediaId, entry);
      if (!this.keep()) {
        entry.snapshot.state = 'failed';
        entry.snapshot.message =
          'Drashti could not keep this copy request. Check free disk space, then Retry.';
      }
    }
    if (entry.snapshot.state === 'ready') {
      const copy = entry.snapshot.readyMediaId ? this.deps.row(entry.snapshot.readyMediaId) : null;
      if (!this.available(copy) || copy.sha256 !== entry.copySha) {
        entry.snapshot.state = 'waiting';
        entry.snapshot.readyMediaId = null;
        entry.copySha = null;
      }
    }
    if (retry && (entry.snapshot.state === 'failed' || entry.snapshot.state === 'stopped')) {
      entry.snapshot.state = 'waiting';
      entry.snapshot.message = null;
      this.keep();
    }
    void this.step();
    return { ok: true, proxy: { ...entry.snapshot } };
  }
  /** A showing captures this ID once. Unknown-size sources keep their existing route until an idle check. */
  readyFor(mediaId: string): { mediaId: string | null; message: string | null } {
    if (this.sourceOf(mediaId) !== mediaId) return { mediaId, message: null };
    const result = this.get(mediaId);
    if (!result.ok) return { mediaId, message: null };
    const proxy = result.proxy;
    if (!proxy.required || proxy.state === 'ready' || proxy.state === 'not-needed')
      return { mediaId: proxy.readyMediaId ?? mediaId, message: null };
    return {
      mediaId: null,
      message:
        proxy.message ??
        'This video’s lighter playing copy is preparing. Wait until it is ready before showing it.',
    };
  }
  activityChanged(): void {
    if (!this.deps.idle()) for (const entry of this.entries.values()) entry.controller?.abort();
  }
  stop(mediaId: string): boolean {
    const entry = this.entries.get(mediaId);
    if (!entry || entry.snapshot.state === 'ready' || entry.snapshot.state === 'not-needed') return false;
    entry.snapshot.state = 'stopped';
    entry.snapshot.note = null;
    entry.snapshot.message = 'The lighter copy was stopped. Press Retry while idle to prepare it.';
    entry.controller?.abort();
    if (entry.job) this.deps.conversions.cancelFile(entry.job);
    this.keep();
    return true;
  }
  private current(entry: ProxyEntry): boolean {
    if (this.closed || entry.snapshot.state === 'stopped') return false;
    const row = this.deps.row(entry.snapshot.mediaId);
    return this.available(row) && row.sha256 === entry.sha;
  }
  private async step(): Promise<void> {
    if (this.closed || this.working || !this.deps.idle() || !this.slow()) return;
    this.working = true;
    try {
      let found = [...this.entries.values()].find(
        (e) => e.snapshot.state === 'checking' || e.snapshot.state === 'waiting',
      );
      if (!found) {
        const derived = new Set(
          [...this.entries.values()].flatMap((e) =>
            e.snapshot.required && e.snapshot.readyMediaId ? [e.snapshot.readyMediaId] : [],
          ),
        );
        for (const id of this.deps.sourceIds()) {
          if (this.entries.has(id) || derived.has(id)) continue;
          const row = this.deps.row(id);
          if (!this.available(row) || row.playable === false) continue;
          found = this.newEntry(id, row.sha256 ?? '');
          this.entries.set(id, found);
          this.keep();
          break;
        }
      }
      if (!found) return;
      const entry = found;
      const source = this.deps.row(entry.snapshot.mediaId);
      if (!this.available(source) || source.sha256 !== entry.sha) {
        entry.snapshot.state = 'failed';
        entry.snapshot.message = 'The original video changed. Open it in Media and Retry.';
        return;
      }
      const snapshot = entry.snapshot;
      const info: MediaInfo = { durationMs: source.durationMs, video: null, audio: null };
      const encoded: { info: MediaInfo | null; id: string | null } = { info: null, id: null };
      snapshot.note = null;
      const queued = this.deps.conversions.saveCopy(
        join(this.deps.mediaDir, source.path),
        join(this.work, `${entry.sha}.mp4`),
        info,
        {
          waitForShow: true,
          strictPriority: true,
          background: true,
          kind: 'proxy',
          lengthMs: source.durationMs ?? 0,
          inspect: (read) => {
            Object.assign(info, read);
            const plan = proxyPlan(read, this.deps.computer());
            if (!plan) {
              snapshot.required = false;
              return false;
            }
            snapshot.required = true;
            snapshot.readyMediaId = null;
            snapshot.width = plan.width;
            snapshot.height = plan.height;
            this.keep();
            return undefined;
          },
          args: (tmp) => proxyArgs(join(this.deps.mediaDir, source.path), tmp, info, this.deps.computer()),
          validate: (read) => {
            if (
              !read.video ||
              !read.durationMs ||
              Math.max(read.video.width, read.video.height) > 1920 ||
              Math.min(read.video.width, read.video.height) > 1080 ||
              (info.durationMs !== null && Math.abs(read.durationMs - info.durationMs) > 250)
            )
              return 'The lighter copy did not have the expected size or length. Check the video and Retry.';
            if (hasAlpha(info) && !hasAlpha(read))
              return 'The lighter copy lost its transparency. Check the video and Retry.';
            encoded.info = read;
            return undefined;
          },
          preparePublish: async (temporary, signal) => {
            if (!encoded.info) throw new Error('The copy has not been validated.');
            encoded.id = await this.deps.register(temporary, encoded.info, signal);
          },
          beforePublish: () => {
            if (!this.current(entry)) throw new Error('Source changed.');
          },
          waiting: (note) => {
            snapshot.note = note;
            snapshot.state = note ? 'waiting' : snapshot.required ? 'preparing' : 'checking';
          },
          progress: (fraction) => {
            snapshot.progress = fraction;
            if (!snapshot.note) snapshot.state = snapshot.required ? 'preparing' : 'checking';
          },
        },
      );
      entry.job = queued.id;
      const result = await queued.done;
      entry.job = null;
      if (!this.current(entry)) {
        if (result.ok && result.copy) rmSync(result.copy, { force: true });
        return;
      }
      if (!result.ok) {
        snapshot.state = result.stopped ? 'stopped' : 'failed';
        snapshot.note = null;
        snapshot.message = result.message;
        this.keep();
        return;
      }
      if (!result.copy) {
        snapshot.state = 'not-needed';
        snapshot.readyMediaId = snapshot.mediaId;
        snapshot.note = null;
        this.keep();
        return;
      }
      try {
        if (!encoded.id || !encoded.info) throw new Error('The copy was not registered.');
        const copy = this.deps.row(encoded.id);
        if (!this.available(copy)) throw new Error('The copy is unavailable.');
        snapshot.state = 'ready';
        snapshot.readyMediaId = encoded.id;
        snapshot.progress = 1;
        snapshot.note = null;
        snapshot.message = null;
        snapshot.width = encoded.info.video?.width ?? null;
        snapshot.height = encoded.info.video?.height ?? null;
        entry.copySha = copy.sha256;
        if (!this.keep()) {
          snapshot.state = 'failed';
          snapshot.readyMediaId = null;
          entry.copySha = null;
          snapshot.message =
            'The lighter copy’s identity could not be saved. Check free space, then Retry lighter copy.';
        }
      } finally {
        rmSync(result.copy, { force: true });
      }
    } catch {
      const entry = [...this.entries.values()].find((e) => e.job !== null);
      if (entry) {
        entry.job = null;
        entry.snapshot.state = 'failed';
        entry.snapshot.note = null;
        entry.snapshot.message =
          'Drashti could not keep this lighter copy. Check its file and free space, then Retry.';
        this.keep();
      }
    } finally {
      this.working = false;
    }
  }
  /** Follow an immutable proxy back to the full-quality source or prepared rendition it represents. */
  sourceOf(mediaId: string): string {
    return (
      [...this.entries.values()].find((e) => e.snapshot.required && e.snapshot.readyMediaId === mediaId)
        ?.snapshot.mediaId ?? mediaId
    );
  }
  close(): void {
    this.keep();
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      if (entry.job) this.deps.conversions.cancelFile(entry.job);
    }
  }
}
