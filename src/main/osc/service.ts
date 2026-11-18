import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { z } from 'zod';
import { DEFAULT_OSC_SETTINGS, type OscResult, type OscSettings, type OscStatus } from '../../shared/osc';
import { isLocalAddress, isLoopback } from '../network/addresses';
import { RateLimiter } from '../network/limits';
import { mapOsc, type OscAction } from './mapping';
import { OSC_LIMITS, readOsc } from './reader';

export interface OscDeps {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  letIn(): boolean;
  canConfigure(): boolean;
  run(action: OscAction): boolean;
  changed(status: OscStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
  createSocket?(): Socket;
}

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    senders: z
      .array(
        z
          .string()
          .trim()
          .max(15)
          .refine((a) => isIP(a) === 4 && isLocalAddress(a)),
      )
      .min(1)
      .max(32),
  })
  .strict();

export function parseOscSettings(raw: unknown): OscSettings | null {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data.senders).size !== parsed.data.senders.length) return null;
  return parsed.data;
}

const MAX_PENDING = 64;
const MAX_AHEAD_MS = 60_000;
interface Pending {
  at: number;
  sender: string;
  action: OscAction;
}

/** A separately enabled, receive-only UDP door into the existing show action layer. */
export class OscService {
  private config: OscSettings;
  private accessAllowed: boolean;
  private socket: Socket | null = null;
  private state: OscStatus['state'] = 'off';
  private message: string | null = null;
  private received = 0;
  private actions = 0;
  private dropped = 0;
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private notice: ReturnType<typeof setTimeout> | null = null;
  private finishStart: (() => void) | null = null;
  private turn: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly now: () => number;
  private readonly ingress: RateLimiter;
  private readonly perSender: RateLimiter;
  private readonly overall: RateLimiter;

  constructor(private readonly deps: OscDeps) {
    this.accessAllowed = deps.letIn();
    const saved = deps.settings.get('osc');
    this.config = parseOscSettings(saved) ?? {
      ...DEFAULT_OSC_SETTINGS,
      senders: [...DEFAULT_OSC_SETTINGS.senders],
    };
    if (saved !== undefined && !parseOscSettings(saved))
      deps.log('warn', 'OSC settings could not be read; OSC stays off');
    this.now = () => this.deps.now?.() ?? Date.now();
    this.ingress = new RateLimiter(50, 200, this.now);
    this.perSender = new RateLimiter(20, 40, this.now);
    this.overall = new RateLimiter(40, 80, this.now);
  }

  status(): OscStatus {
    return {
      settings: { ...this.config, senders: [...this.config.senders] },
      state: this.state,
      message: this.message,
      received: this.received,
      actions: this.actions,
      dropped: this.dropped,
      pending: this.pending.length,
    };
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.turn.then(run);
    this.turn = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  resume(): Promise<void> {
    return this.enqueue(() => this.restart());
  }

  configure(raw: unknown): Promise<OscResult> {
    const config = parseOscSettings(raw);
    if (!config)
      return Promise.resolve({
        ok: false,
        message: 'Choose a port from 1024 to 65535 and list 1 to 32 different local IPv4 sender addresses.',
      });
    return this.enqueue(async () => {
      if (this.closed || !this.deps.letIn() || !this.deps.canConfigure())
        return { ok: false, message: 'Set up OSC in Pro Mode on the Drashti computer.' };
      try {
        this.deps.settings.set('osc', config);
      } catch {
        return { ok: false, message: 'OSC settings could not be saved. Try again.' };
      }
      this.config = config;
      await this.restart();
      return this.state === 'failed'
        ? { ok: false, message: this.message ?? 'OSC could not listen. Try again.' }
        : { ok: true, status: this.status() };
    });
  }

  accessChanged(): Promise<void> {
    return this.enqueue(async () => {
      if (this.deps.letIn() !== this.accessAllowed) await this.restart();
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return this.enqueue(() => this.stop());
  }

  private changed(): void {
    if (this.notice) clearTimeout(this.notice);
    this.notice = null;
    this.deps.changed(this.status());
  }

  /** A packet flood cannot turn into a flood of window updates or log writes. */
  private counted(): void {
    if (this.notice || this.closed) return;
    this.notice = setTimeout(() => {
      this.notice = null;
      this.deps.changed(this.status());
    }, 250);
    this.notice.unref();
  }

  private async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    const socket = this.socket;
    this.socket = null;
    this.finishStart?.();
    this.finishStart = null;
    if (socket) {
      await new Promise<void>((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      });
      this.deps.log('info', 'OSC stopped listening');
    }
    this.state = 'off';
    this.message = null;
    this.changed();
  }

  private async restart(): Promise<void> {
    await this.stop();
    this.accessAllowed = this.deps.letIn();
    if (this.closed || !this.config.enabled) return;
    if (!this.accessAllowed) {
      this.message = 'OSC is waiting until Drashti is let in.';
      this.changed();
      return;
    }
    this.state = 'starting';
    this.changed();
    await new Promise<void>((resolve) => {
      this.finishStart = resolve;
      let socket: Socket;
      try {
        socket = this.deps.createSocket?.() ?? createSocket('udp4');
      } catch {
        this.failed();
        resolve();
        return;
      }
      this.socket = socket;
      socket.on('error', (error: NodeJS.ErrnoException) => {
        if (this.socket !== socket) return;
        this.socket = null;
        try {
          socket.close();
        } catch {
          /* It may not have bound yet. */
        }
        this.failed(error.code);
        resolve();
      });
      socket.on('message', (packet, remote) => {
        if (this.socket === socket && this.state === 'listening') this.receive(packet, remote.address);
      });
      try {
        socket.unref();
        socket.bind(this.config.port, this.config.senders.every(isLoopback) ? '127.0.0.1' : '0.0.0.0', () => {
          if (this.socket !== socket) {
            resolve();
            return;
          }
          this.state = 'listening';
          this.message = null;
          this.finishStart = null;
          this.deps.log('info', 'OSC started listening');
          this.changed();
          resolve();
        });
      } catch (error) {
        this.socket = null;
        try {
          socket.close();
        } catch {
          /* It did not bind. */
        }
        this.failed((error as NodeJS.ErrnoException).code);
        resolve();
      }
    });
  }

  private failed(code?: string): void {
    this.finishStart = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    this.state = 'failed';
    this.message =
      code === 'EADDRINUSE'
        ? 'That OSC port is already in use. Choose another port, or close the other listener.'
        : 'OSC could not listen. Turn it off and on to try again.';
    this.deps.log('warn', 'OSC could not listen');
    this.changed();
  }

  private receive(packet: Buffer, sender: string): void {
    this.received++;
    this.counted();
    const drop = () => {
      this.dropped++;
    };
    if (
      !this.config.enabled ||
      !this.deps.letIn() ||
      !this.config.senders.includes(sender) ||
      !this.ingress.take('all') ||
      packet.length > OSC_LIMITS.bytes
    ) {
      drop();
      return;
    }
    const messages = readOsc(packet);
    if (!messages) {
      drop();
      return;
    }
    const now = this.now();
    const batch: Pending[] = [];
    for (const message of messages) {
      const action = mapOsc(message);
      const at =
        message.timetag === 1n
          ? now
          : Math.ceil(
              (Number(message.timetag >> 32n) - 2_208_988_800) * 1000 +
                (Number(message.timetag & 0xffff_ffffn) * 1000) / 0x1_0000_0000,
            );
      if (!action || at > now + MAX_AHEAD_MS) {
        drop();
        return;
      }
      batch.push({ at: Math.max(now, at), sender, action });
    }
    const future = batch.filter((p) => p.at > now);
    if (this.pending.length + future.length > MAX_PENDING) {
      drop();
      return;
    }
    // Reserve every action's allowance before any part of a bundle reaches the engine.
    for (const _ of batch) {
      if (!this.overall.take('all') || !this.perSender.take(sender)) {
        drop();
        return;
      }
    }
    for (const item of batch) {
      if (item.at <= now) this.run(item);
      else this.pending.push(item);
    }
    this.schedule();
  }

  private run(item: Pending): void {
    if (
      !this.socket ||
      !this.config.enabled ||
      !this.deps.letIn() ||
      !this.config.senders.includes(item.sender)
    ) {
      this.dropped++;
      return;
    }
    try {
      if (this.deps.run(item.action)) this.actions++;
      else this.dropped++;
    } catch {
      this.dropped++;
      // No supplied error, address, argument or content is copied into the log.
      this.deps.log('warn', 'OSC action could not run');
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.sort((a, b) => a.at - b.at);
    const first = this.pending[0];
    if (!first) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        const now = this.now();
        while (this.pending[0] && this.pending[0].at <= now) {
          const item = this.pending.shift();
          if (item) this.run(item);
        }
        this.counted();
        this.schedule();
      },
      Math.min(MAX_AHEAD_MS, Math.max(0, first.at - this.now())),
    );
    this.timer.unref();
  }
}
