import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoEditSnapshot } from '../../shared/video-edit';
import type { VideoEditsRepo } from '../db/video-edits';
import type { SourceWrite } from '../documents/source-write';
import type { ConvertService, CopyOptions } from './convert-service';
import { editPlan, type EditPlan } from './edit-plan';
import { hasAlpha, type MediaInfo } from './plan';

/** Shared worker hooks are supplied by x63's foundation; this service never starts a subprocess itself. */
export type EditCopyOptions = CopyOptions & {
  inspect(info: MediaInfo): undefined | string;
  validate(info: MediaInfo): undefined | string;
  strictPriority: true;
  preparePublish(temporary: string, signal: AbortSignal): Promise<void>;
};
export interface EditServiceDeps {
  repo: Pick<VideoEditsRepo, 'read' | 'waiting' | 'complete' | 'failed'>;
  mediaDir: string;
  source(mediaId: string): { path: string; name: string } | null;
  idle(): boolean;
  conversions: {
    saveCopy(
      source: string,
      dest: string,
      info: MediaInfo,
      copy: EditCopyOptions,
    ): ReturnType<ConvertService['saveCopy']>;
    cancelFile: ConvertService['cancelFile'];
  };
  register(file: string, info: MediaInfo, name: string, signal: AbortSignal): Promise<string>;
  changed(edit: VideoEditSnapshot): void;
  write: SourceWrite;
}

/** Desired recipes persist in SQLite. Interrupted work is rediscovered after restart, with no unedited fallback. */
export class EditService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: { sourceId: string; revision: number; job: string } | null = null;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly failing = new Set<string>();
  private readonly work: string;
  constructor(private readonly deps: EditServiceDeps) {
    this.work = join(deps.mediaDir, 'video-edit-work');
    rmSync(this.work, { recursive: true, force: true });
    mkdirSync(this.work, { recursive: true });
  }
  resume(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
    this.wake();
  }
  wake(): void {
    if (this.closed) return;
    if (this.active) {
      const current = this.deps.repo.read(this.active.sourceId);
      if (current?.revision !== this.active.revision || current.state !== 'preparing')
        this.deps.conversions.cancelFile(this.active.job);
      return;
    }
    if (!this.deps.idle()) return;
    const pending = this.deps.repo.waiting()[0];
    if (!pending || this.failing.has(`${pending.mediaId}/${String(pending.revision)}`)) return;
    const source = this.deps.source(pending.mediaId);
    if (!source || !existsSync(source.path)) {
      this.fail(
        pending.mediaId,
        pending.revision,
        'The source video’s file is missing. Restore it, then Save the edits again.',
      );
      return;
    }
    const info: MediaInfo = { durationMs: null, video: null, audio: null };
    let plan: EditPlan | null = null;
    let checked: MediaInfo | null = null;
    let copyId: string | null = null;
    const current = () => {
      if (this.closed) return false;
      try {
        const edit = this.deps.repo.read(pending.mediaId);
        return edit?.revision === pending.revision && edit.state === 'preparing';
      } catch {
        return false;
      }
    };
    const options: EditCopyOptions = {
      lengthMs: 0,
      // Only what plays, the stream or a recording holds Edit Video's Save (alpha.22, shared/save-waits.ts).
      waitForPlaying: true,
      strictPriority: true,
      inspect: (read) => {
        if (!current()) return 'These edits have been replaced by a newer save.';
        Object.assign(info, read);
        try {
          plan = editPlan({
            file: source.path,
            recipe: pending.recipe,
            info,
            identity: `${pending.mediaId}-${String(pending.revision)}`,
          });
          options.lengthMs = plan.durationMs;
        } catch (error) {
          return error instanceof Error
            ? error.message
            : 'The source video could not be prepared. Check its edits, then Save again.';
        }
        return undefined;
      },
      args: (temporary) => {
        if (!plan) throw new Error('The video has not been read by the idle worker.');
        return plan.args(temporary);
      },
      validate: (read) => {
        if (
          !plan ||
          !read.video ||
          !read.durationMs ||
          Math.abs(read.durationMs - plan.durationMs) > 250 ||
          (hasAlpha(info) && !hasAlpha(read))
        )
          return 'The edited video did not have the expected picture, length or transparency. Check its source and Save again.';
        checked = read;
        return undefined;
      },
      preparePublish: async (temporary, signal) => {
        if (!checked || !current() || !this.deps.idle())
          throw new Error('The edits are no longer ready to publish.');
        copyId = await this.deps.register(temporary, checked, `${source.name} — edited`, signal);
      },
      beforePublish: () => {
        if (!current() || !this.deps.idle()) throw new Error('The showing or saved edits changed.');
      },
    };
    const job = this.deps.conversions.saveCopy(
      source.path,
      join(this.work, `${pending.mediaId}-${String(pending.revision)}.copy`),
      info,
      options,
    );
    this.active = { sourceId: pending.mediaId, revision: pending.revision, job: job.id };
    void job.done
      .then(async (result) => {
        if (result.ok && result.copy) rmSync(result.copy, { force: true });
        if (!current()) return;
        if (!result.ok) {
          if (!result.stopped) this.fail(pending.mediaId, pending.revision, result.message);
          return;
        }
        if (!copyId) {
          this.fail(
            pending.mediaId,
            pending.revision,
            'The edited file could not be kept. Check free space and Save again.',
          );
          return;
        }
        // The worker's last idle check and this synchronous CAS are separated only by promise settlement.
        if (!this.deps.idle()) return;
        const id = copyId;
        const completed = await this.deps.write(
          { signal: this.lifetime.signal, allowed: () => current() && this.deps.idle() },
          () => this.deps.repo.complete(pending.mediaId, pending.revision, id),
        );
        if (completed) this.tell(pending.mediaId);
      })
      .catch(() => {
        if (current())
          this.fail(
            pending.mediaId,
            pending.revision,
            'The edited video could not be prepared. Check its file and free space, then Save again.',
          );
      })
      .finally(() => {
        this.active = null;
        if (!this.closed) this.wake();
      });
  }
  private tell(id: string): void {
    const edit = this.deps.repo.read(id);
    if (edit) this.deps.changed(edit);
  }
  private fail(id: string, revision: number, message: string): void {
    const key = `${id}/${String(revision)}`;
    this.failing.add(key);
    void this.deps
      .write({ signal: this.lifetime.signal, allowed: () => !this.closed && this.deps.idle() }, () =>
        this.deps.repo.failed(id, revision, message),
      )
      .then(() => this.tell(id))
      .catch(() => undefined)
      .finally(() => this.failing.delete(key));
  }
  close(): void {
    this.closed = true;
    this.lifetime.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.active) this.deps.conversions.cancelFile(this.active.job);
  }
}
