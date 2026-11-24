import type { Layers } from '../../shared/engine/state';
import type { ClockStyle } from '../../shared/format';
import type { OutputContext, ScreenGroupConfig } from '../../shared/screens';
import type { LiveUnseen } from '../../shared/studio-live';
import type { CapturedImage } from './studio-live';

/*
 * Live's copy (alpha.23): skeleton (Red).
 */

export const LIVE_COPY_SIZE = { width: 960, height: 540 } as const;
export const LIVE_COPY_FPS = 1;
export const LIVE_COPY_QUERY = 'liveCopy';
export const LIVE_COPY_SCREEN_ID = 'live-copy';

export interface LiveCopyWindow {
  latest(): CapturedImage | null;
  isDestroyed(): boolean;
  close(): void;
}

export interface LiveCopyDeps {
  open(gone: () => void): LiveCopyWindow | null;
  log(line: string): void;
}

export class LiveCopy {
  constructor(private readonly deps: LiveCopyDeps) {}

  get isOpen(): boolean {
    return false;
  }

  still(): CapturedImage | null {
    void this.deps;
    return null;
  }

  close(): void {
    // Red: nothing yet.
  }
}

export function liveCopyContext(_groups: readonly ScreenGroupConfig[], _clockStyle?: ClockStyle): OutputContext {
  return {
    screenId: '',
    screenName: '',
    groupId: '',
    groupName: '',
    role: 'stage',
    feed: null,
    canvasWidth: 0,
    canvasHeight: 0,
    scaling: 'fit',
    display: null,
  };
}

export function unseenInCopy(_layers: Pick<Layers, 'background' | 'pip'>): LiveUnseen[] {
  return [];
}

export function liveCopyOptions(): Record<string, unknown> {
  return {};
}

export function liveCopyQuery(): Record<string, string> {
  return {};
}
