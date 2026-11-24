import type { Rectangle } from 'electron';
import type { ScreenRole } from '../../shared/screens';
import type { StudioLivePicture, StudioLiveSource } from '../../shared/studio-live';

/*
 * Live behind the Lower Thirds studio's preview (alpha.22): not yet.
 */

export const LIVE_EVERY_MS = 1000;
export const LIVE_WIDTH = 960;

export interface StudioLiveDeps {
  take(): Promise<StudioLivePicture | null>;
  send(picture: StudioLivePicture | null): void;
  log(line: string): void;
  everyMs?: number;
}

export class StudioLive {
  taken = 0;
  constructor(private readonly deps: StudioLiveDeps) {}
  get watching(): boolean {
    return false;
  }
  watch(_on: boolean): void {
    void this.deps;
  }
}

export function hallScreenOf(
  _screens: readonly { id: string; groupId: string }[],
  _roleOf: (groupId: string) => ScreenRole | null,
  _showing: (screenId: string) => boolean,
): string | null {
  return null;
}

export function liveRectOf(_seen: unknown): Rectangle | null {
  return null;
}

export interface CapturedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; quality: 'good' }): CapturedImage;
  toJPEG(quality: number): Buffer;
}

export function livePictureOf(
  _image: CapturedImage,
  _source: StudioLiveSource,
  _at: number,
): StudioLivePicture | null {
  return null;
}
