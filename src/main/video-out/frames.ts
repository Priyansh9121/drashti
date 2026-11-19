import type { FromProgram } from '../stream/worker/protocol';
import type { VideoOutWorkerStatus } from './protocol';

/* Red (x30): the shape of the video-out process's frame handling, not yet built. */

export type RawFormat = 'I420' | 'NV12' | 'BGRA' | 'RGBA';

export interface RawFrame {
  format: RawFormat;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Sender {
  frame(frame: RawFrame): boolean;
  error(): string | null;
  stop(): void;
}

export function frameBytes(_format: RawFormat, _width: number, _height: number): number {
  return 0;
}

export const REPORT_MS = 1000;

export class FrameReceiver {
  constructor(
    private readonly sender: Sender,
    readonly report: (status: VideoOutWorkerStatus) => void,
    readonly now: () => number,
    readonly log: (level: 'info' | 'warn', message: string) => void = () => undefined,
  ) {}

  fromProgram(_message: FromProgram): void {
    // Not built yet.
  }

  status(): VideoOutWorkerStatus {
    return { frames: 0, dropped: 0, size: null, error: this.sender.error() };
  }
}

export function middleColour(_frame: RawFrame): [number, number, number] {
  return [0, 0, 0];
}
