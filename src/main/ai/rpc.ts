import { randomUUID } from 'node:crypto';
import type { AiSearchHint } from '../../shared/search';
import { workerReplySchema, type AiChild, type WorkerContext, type WorkerJob } from './protocol';
type Task = WorkerJob extends infer J ? (J extends WorkerJob ? Omit<J, 'id' | 'context'> : never) : never;
interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  progress?: (hints: AiSearchHint[]) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class AiWorkerRpc {
  private child: AiChild | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Waiting>();
  constructor(
    private readonly spawn: () => AiChild,
    private readonly context: WorkerContext,
  ) {}
  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const child = this.spawn();
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      const startup = setTimeout(() => {
        reject(new Error('HELPER_UNAVAILABLE'));
        this.cancel();
      }, 15000);
      child.onMessage((raw) => {
        if (child !== this.child) return;
        const parsed = workerReplySchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'ready') {
          clearTimeout(startup);
          if (message.lowPriority) resolve();
          else {
            reject(new Error('HELPER_UNAVAILABLE'));
            this.cancel();
          }
          return;
        }
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        if (message.type === 'progress') {
          waiting.progress?.(message.hints);
          return;
        }
        clearTimeout(waiting.timer);
        this.pending.delete(message.id);
        if (message.type === 'done') waiting.resolve(message.value);
        else waiting.reject(new Error('HELPER_UNAVAILABLE'));
      });
      child.onExit(() => {
        clearTimeout(startup);
        reject(new Error('HELPER_UNAVAILABLE'));
        if (child === this.child) this.cancel();
      });
    });
    return this.ready;
  }
  async run(task: Task, progress?: (hints: AiSearchHint[]) => void): Promise<unknown> {
    if (this.pending.size >= 16) throw new Error('HELPER_BUSY');
    await this.start();
    const child = this.child;
    if (!child) throw new Error('HELPER_UNAVAILABLE');
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error('HELPER_UNAVAILABLE'));
          this.cancel();
        },
        10 * 60 * 1000,
      );
      this.pending.set(id, { resolve, reject, timer, ...(progress ? { progress } : {}) });
      child.post({ ...task, id, context: this.context });
    });
  }
  busy(until: number): void {
    this.child?.post({ type: 'busy', until });
  }
  cancel(): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    child?.kill();
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error('CANCELLED'));
    }
    this.pending.clear();
  }
}
