import type { MessagePortMain } from 'electron';
import {
  type VideoOutResult,
  type VideoOutSettings,
  videoOutSettingsFrom,
  type VideoOutStatus,
} from '../../shared/video-out';
import type { VideoOutSender } from './protocol';
import type { VideoOutWorker } from './spawn';

/* Red (x30): video out's service in the main process, not yet built. */

export interface VideoOutDeps {
  readSetting(): unknown;
  writeSetting(settings: VideoOutSettings): void;
  sender(): VideoOutSender | null;
  holdProgram(on: boolean): void;
  pairProgram(port: MessagePortMain): boolean;
  channel(): { port1: MessagePortMain; port2: MessagePortMain };
  spawnWorker(): VideoOutWorker;
  log(level: 'info' | 'warn', line: string): void;
  changed(status: VideoOutStatus): void;
  now(): number;
  later(run: () => void, ms: number): void;
}

export const RESTART_MS = 1000;
export const RESTARTS = 5;
export const STOP_KILL_MS = 2000;
export const STOPPED_MESSAGE =
  'Sending stopped after failing again and again. Turn it off and on again to try once more.';
export const UNAVAILABLE_MESSAGE = 'This computer’s Drashti cannot send its picture to other software.';
export const NAME_MESSAGE = 'Give it a name of letters, digits and spaces, up to 40.';

export class VideoOutService {
  private readonly settings: VideoOutSettings;

  constructor(readonly deps: VideoOutDeps) {
    this.settings = videoOutSettingsFrom(deps.readSetting());
  }

  start(): void {
    // Not built yet.
  }

  status(): VideoOutStatus {
    return { settings: this.settings, state: 'off', way: null, frames: 0, size: null, message: null };
  }

  set(_raw: unknown): VideoOutResult {
    return { ok: false, message: 'Not built yet.' };
  }

  programChanged(): void {
    // Not built yet.
  }

  close(): void {
    // Not built yet.
  }
}
