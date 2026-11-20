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
  inspect(info: MediaInfo): void | string;
  validate(info: MediaInfo): void | string;
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
  private readonly work: string;
  constructor(private readonly deps: EditServiceDeps) {
    this.work = join(deps.mediaDir, 'video-edit-work');
    mkdirSync(this.work, { recursive: true });
  }
  resume(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
    this.wake();
  }
  wake(): void {
    /* Red scaffold: the idle service has not queued anything yet. */
  }
  private tell(id: string): void {
    const edit = this.deps.repo.read(id);
    if (edit) this.deps.changed(edit);
  }
  private fail(id: string, revision: number, message: string): void {
    this.deps.repo.failed(id, revision, message);
    this.tell(id);
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.active) this.deps.conversions.cancelFile(this.active.job);
  }
}
