import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  configSchema,
  DAY,
  ERROR_LIMITS,
  eventSchema,
  MAC_PREFIX,
  reportSchema,
  type ErrorReportConfig,
  type Incident,
} from './protocol';
export type { Incident } from './protocol';

const stateSchema = z
  .object({
    v: z.literal(1),
    enabled: z.boolean(),
    config: configSchema.nullable(),
    day: z.number().int(),
    sentDay: z.number().int(),
    sentIds: z.array(z.string().regex(/^[a-f0-9]{32}$/u)).max(ERROR_LIMITS.perDay),
    captured: z.number().int().min(0).max(ERROR_LIMITS.perDay),
    dropped: z.number().int().min(0).max(1_000_000_000),
    queue: z.array(reportSchema).max(ERROR_LIMITS.pending),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const fresh = (): State => ({
  v: 1,
  enabled: false,
  config: null,
  day: 0,
  captured: 0,
  sentDay: 0,
  sentIds: [],
  dropped: 0,
  queue: [],
});
export interface ErrorReportsDeps {
  dir: string;
  now(): number;
  owner(): boolean;
  letIn(): boolean;
  onAir(): boolean;
  /** Local fake in tests. Production transport acknowledges only the same report id. */
  send(config: ErrorReportConfig, body: string, signal: AbortSignal): Promise<boolean>;
}

/** Main-process only; no renderer can submit arbitrary text or enable consent. One owner per data folder. */
export class ErrorReports {
  private state: State = fresh();
  private sending = false;
  private stop: AbortController | null = null;
  private revision = 0;
  private healthy = true;
  private dirtyDrops = false;
  private disposed = false;
  private readonly file: string;

  constructor(private readonly d: ErrorReportsDeps) {
    this.file = join(d.dir, 'state.json');
    try {
      if (existsSync(this.file)) {
        if (readFileSync(this.file).byteLength > 2_000_000) throw new Error('size');
        this.state = stateSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      }
    } catch {
      // Corrupt state must never silently restore consent or reset a daily limit.
      this.healthy = false;
    }
  }

  status(): { enabled: boolean; configured: boolean; pending: number; healthy: boolean } {
    return {
      enabled: !this.disposed && this.healthy && this.state.enabled,
      configured: this.state.config !== null,
      pending: this.pending(),
      healthy: this.healthy,
    };
  }

  configure(input: unknown): boolean {
    if (this.disposed || !this.d.owner() || !this.healthy) return false;
    const parsed = configSchema.safeParse(input);
    if (!parsed.success) return false;
    this.cancel();
    // A changed destination requires fresh consent; reports never cross into another install.
    return this.save({ ...this.state, enabled: false, config: parsed.data, queue: [] });
  }

  enable(on: boolean): boolean {
    if (this.disposed || !this.d.owner() || !this.healthy || (on && !this.state.config)) return false;
    this.cancel();
    return this.save({ ...this.state, enabled: on, queue: on ? this.state.queue : [] });
  }

  capture(input: Incident): boolean {
    return this.captureWith(() => input);
  }

  /** Collect diagnostics only after consent, access and both caps have been checked. */
  captureWith(make: () => Incident | null): boolean {
    if (this.disposed || !this.healthy || !this.state.enabled || !this.state.config || !this.d.letIn())
      return false;
    const now = this.d.now();
    const day = Math.max(this.state.day, Math.floor(now / DAY));
    const next = {
      ...this.state,
      day,
      captured: day === this.state.day ? this.state.captured : 0,
      queue: this.liveQueue(now),
    };
    if (next.captured >= ERROR_LIMITS.perDay || next.queue.length >= ERROR_LIMITS.pending) {
      // Suppressed errors never rewrite the outbox on Main. Coalesce counts until an idle wake/write/close.
      this.state = { ...next, dropped: Math.min(1_000_000_000, next.dropped + 1) };
      this.dirtyDrops = true;
      return false;
    }
    let input: Incident | null;
    try {
      input = make();
    } catch {
      return false;
    }
    if (!input) return false;
    // Explicit projection: raw messages, stacks, names, paths and unknown event strings never enter the outbox.
    const events = input.events.slice(-ERROR_LIMITS.events).flatMap((event) => {
      const parsed = eventSchema.safeParse({ at: event.at, code: event.code, count: event.count });
      return parsed.success ? [parsed.data] : [];
    });
    const parsed = reportSchema.safeParse({
      id: randomBytes(16).toString('hex'),
      at: now,
      diagnosticsInstallId: input.diagnosticsInstallId,
      mode: input.mode,
      osRelease: input.osRelease,
      computerId: input.computerId,
      accessEntryId: input.accessEntryId,
      version: input.version,
      platform: input.platform,
      arch: input.arch,
      role: input.role,
      counts: {
        minutes: input.counts.minutes,
        shows: input.counts.shows,
        streams: input.counts.streams,
        recordings: input.counts.recordings,
        imports: input.counts.imports,
      },
      trigger: input.trigger,
      code: input.code,
      dropped: next.dropped,
      events,
    });
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > ERROR_LIMITS.bytes) return false;
    return this.save({
      ...next,
      captured: next.captured + 1,
      dropped: 0,
      queue: [...next.queue, parsed.data],
    });
  }

  pending(): number {
    return this.liveQueue(this.d.now()).length;
  }

  /** Called at startup, when connectivity/access returns, and after the show. No parallel send or tight retry loop. */
  async wake(): Promise<void> {
    if (this.sending || !this.canSend()) return;
    this.sending = true;
    const revision = this.revision;
    try {
      if (this.dirtyDrops && !this.save(this.state)) return;
      const queue = this.liveQueue(this.d.now());
      if (queue.length !== this.state.queue.length && !this.save({ ...this.state, queue })) return;
      if (queue.length === 0) return;
      while (this.canSend() && revision === this.revision) {
        // An awaited upload can cross another report's expiry boundary.
        const live = this.liveQueue(this.d.now());
        if (live.length !== this.state.queue.length && !this.save({ ...this.state, queue: live })) return;
        const report = this.state.queue[0];
        const config = this.state.config;
        if (!report || !config) return;
        // Reserve each distinct report before posting. A lost receipt/disable/restart cannot reopen the budget.
        const sentDay = Math.max(this.state.sentDay, Math.floor(this.d.now() / DAY));
        const sentIds = sentDay === this.state.sentDay ? this.state.sentIds : [];
        if (!sentIds.includes(report.id)) {
          if (sentIds.length >= ERROR_LIMITS.perDay) return;
          if (!this.save({ ...this.state, sentDay, sentIds: [...sentIds, report.id] })) return;
        }

        const payload = JSON.stringify(report);
        const mac = createHmac('sha256', config.secret)
          .update(MAC_PREFIX + config.installId + '\n' + payload)
          .digest('hex');
        const body = JSON.stringify({ v: 1, installId: config.installId, payload, mac });
        this.stop = new AbortController();
        let received = false;
        try {
          received = await this.d.send(config, body, this.stop.signal);
        } catch {
          /* Offline: keep the same id. */
        }
        if (revision !== this.revision || !received) return;
        if (!this.save({ ...this.state, queue: this.state.queue.filter((r) => r.id !== report.id) })) return;
      }
    } finally {
      this.stop = null;
      this.sending = false;
    }
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    if (this.healthy && this.dirtyDrops) this.save(this.state);
  }

  /** Abort before streaming/recording starts or on shutdown. Consent and queued reports stay on disk. */
  cancel(): void {
    this.revision++;
    this.stop?.abort();
  }
  private canSend(): boolean {
    return (
      !this.disposed &&
      this.healthy &&
      this.state.enabled &&
      this.state.config !== null &&
      this.d.letIn() &&
      !this.d.onAir()
    );
  }
  private liveQueue(now: number): State['queue'] {
    return this.state.queue.filter((r) => now - r.at < ERROR_LIMITS.ageMs);
  }
  private save(next: State): boolean {
    try {
      mkdirSync(this.d.dir, { recursive: true, mode: 0o700 });
      chmodSync(this.d.dir, 0o700);
      writeFileSync(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      chmodSync(this.file + '.tmp', 0o600);
      renameSync(this.file + '.tmp', this.file);
      this.state = next;
      this.dirtyDrops = false;
      return true;
    } catch {
      this.healthy = false;
      this.cancel();
      return false;
    }
  }
}
