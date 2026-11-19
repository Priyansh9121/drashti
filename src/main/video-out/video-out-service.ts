import type { MessagePortMain } from 'electron';
import {
  type VideoOutResult,
  type VideoOutSettings,
  videoOutSettingsFrom,
  videoOutSettingsSchema,
  type VideoOutState,
  type VideoOutStatus,
} from '../../shared/video-out';
import { RestartCap } from '../stream/restart-cap';
import type { VideoOutSender, VideoOutWorkerStatus } from './protocol';
import type { VideoOutWorker } from './spawn';

/*
 * Video out (x30, prompt 11), in the main process: the setting, and while it is on, the video-out process and the
 * stream's page's port to it. Off (as it starts, until someone turns it on): no process, no port, nothing listening
 * or sending, and the stream's page as it was. On: the stream's page is kept open and drawing (as the window for Zoom
 * keeps it), its own capture gives each frame to video out's port as well (the encoder's frames unchanged), and the
 * video-out process hands them to this computer's way. Frames never pass through here.
 */

export interface VideoOutDeps {
  /** The kept setting (read through the schema: off when missing or unreadable). */
  readSetting(): unknown;
  writeSetting(settings: VideoOutSettings): void;
  /** This computer's way to send and where its frames go, or null when it has none. Asked once. */
  sender(): VideoOutSender | null;
  /** Keep the stream's page open and drawing for video out, or let it go. */
  holdProgram(on: boolean): void;
  /** Give the stream's page this port for its frames: false while the page is not ready (`programChanged` pairs). */
  pairProgram(port: MessagePortMain): boolean;
  channel(): { port1: MessagePortMain; port2: MessagePortMain };
  spawnWorker(): VideoOutWorker;
  log(level: 'info' | 'warn', line: string): void;
  changed(status: VideoOutStatus): void;
  now(): number;
  later(run: () => void, ms: number): void;
}

/** A process that ended is started again after this, at most RESTARTS a minute. */
export const RESTART_MS = 1000;
export const RESTARTS = 5;
/** A process asked to stop is ended this long after, if it has not gone by itself. */
export const STOP_KILL_MS = 2000;

export const STOPPED_MESSAGE =
  'Sending stopped after failing again and again. Turn it off and on again to try once more.';
export const UNAVAILABLE_MESSAGE = 'This computer’s Drashti cannot send its picture to other software.';
export const NAME_MESSAGE = 'Give it a name of letters, digits and spaces, up to 40.';

export class VideoOutService {
  private settings: VideoOutSettings;
  private readonly sender: VideoOutSender | null;
  private worker: VideoOutWorker | null = null;
  private workerStatus: VideoOutWorkerStatus | null = null;
  private stopped = false;
  private readonly restarts = new RestartCap(RESTARTS, 60_000);
  private closing = false;
  private lastSaid = '';

  constructor(private readonly deps: VideoOutDeps) {
    this.settings = videoOutSettingsFrom(deps.readSetting());
    this.sender = deps.sender();
  }

  /** As Drashti starts: on again only if someone left it on. */
  start(): void {
    if (this.settings.on) this.turnOn();
    this.changed();
  }

  status(): VideoOutStatus {
    const ws = this.workerStatus;
    const state: VideoOutState = !this.settings.on
      ? 'off'
      : !this.sender
        ? 'unavailable'
        : this.stopped
          ? 'stopped'
          : ws && ws.frames > 0 && !ws.error
            ? 'sending'
            : 'starting';
    return {
      settings: this.settings,
      state,
      way: this.sender?.way ?? null,
      frames: ws?.frames ?? 0,
      size: ws?.size ?? null,
      message:
        state === 'unavailable'
          ? UNAVAILABLE_MESSAGE
          : state === 'stopped'
            ? STOPPED_MESSAGE
            : state === 'off'
              ? null
              : (ws?.error ?? null),
    };
  }

  /** Keep new settings and do what they say (the operator window, Pro Mode). */
  set(raw: unknown): VideoOutResult {
    const parsed = videoOutSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: NAME_MESSAGE };
    const before = this.settings;
    this.settings = parsed.data;
    this.deps.writeSetting(parsed.data);
    if (!parsed.data.on) this.turnOff();
    else if (!before.on || this.stopped) {
      // Turned on (or on again after it stopped): started afresh.
      this.turnOff();
      this.turnOn();
    } else if (before.name !== parsed.data.name) {
      // On under a new name: the process started afresh, the stream's page held all along.
      this.stopWorker();
      this.startWorker();
    }
    this.changed();
    return { ok: true, status: this.status() };
  }

  /** The stream's page loaded (again) or went: its frames come on a new port. */
  programChanged(): void {
    if (this.worker) this.pair();
  }

  /** Drashti is quitting: everything stops, the setting kept as it is. */
  close(): void {
    this.closing = true;
    this.turnOff();
  }

  private turnOn(): void {
    if (this.closing || this.worker || !this.sender) return;
    this.stopped = false;
    this.deps.holdProgram(true);
    this.startWorker();
  }

  private startWorker(): void {
    const sender = this.sender;
    if (this.closing || this.worker || !sender) return;
    const worker = this.deps.spawnWorker();
    this.worker = worker;
    this.workerStatus = null;
    worker.onMessage((message) => {
      if (this.worker !== worker) return;
      if (message.type === 'status') {
        this.workerStatus = message.status;
        this.changed();
      } else this.deps.log(message.level, `Video out: ${message.message}`);
    });
    worker.onExit((code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.workerStatus = null;
      this.exited(code);
    });
    worker.send({ type: 'start', sender, name: this.settings.name });
    this.pair();
    this.deps.log('info', `Video out is on (${sender.way}), as “${this.settings.name}”`);
  }

  private pair(): void {
    const worker = this.worker;
    if (!worker) return;
    const { port1, port2 } = this.deps.channel();
    if (!this.deps.pairProgram(port2)) {
      // The stream's page is not ready: it is paired when it is (programChanged).
      port1.close();
      port2.close();
      return;
    }
    worker.sendFrames(port1);
  }

  private exited(code: number): void {
    if (!this.settings.on || this.closing) return;
    if (!this.restarts.allow(this.deps.now())) {
      this.stopped = true;
      this.deps.holdProgram(false);
      this.deps.log('warn', `The video-out process ended (${String(code)}) too often: it stays stopped`);
      this.changed();
      return;
    }
    this.deps.log('warn', `The video-out process ended (${String(code)}): starting it again`);
    this.changed();
    this.deps.later(() => {
      if (this.settings.on && !this.worker && !this.stopped) this.turnOn();
      this.changed();
    }, RESTART_MS);
  }

  /** The process asked to stop, ended STOP_KILL_MS later if it has not gone: whether there was one. */
  private stopWorker(): boolean {
    const worker = this.worker;
    this.worker = null;
    this.workerStatus = null;
    if (!worker) return false;
    worker.send({ type: 'stop' });
    this.deps.later(() => {
      worker.kill();
    }, STOP_KILL_MS);
    return true;
  }

  private turnOff(): void {
    if (this.stopWorker()) this.deps.log('info', 'Video out is off');
    this.deps.holdProgram(false);
    this.stopped = false;
    this.restarts.reset();
  }

  /** Said to the operator window when what it shows changes (not each frame counted). */
  private changed(): void {
    const status = this.status();
    const said = JSON.stringify({ ...status, frames: status.frames > 0 });
    if (said === this.lastSaid) return;
    this.lastSaid = said;
    this.deps.changed(status);
  }
}
