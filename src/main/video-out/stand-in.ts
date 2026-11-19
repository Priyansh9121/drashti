import type { RawFrame, Sender } from './frames';

/* Red (x30): the tests' stand-in receiver, not yet built. */

export interface StandInSeen {
  name: string;
  frames: number;
  width: number;
  height: number;
  format: RawFrame['format'];
  middle: [number, number, number];
  at: number;
}

export const WRITE_MS = 100;

export interface StandInClock {
  now(): number;
  later(run: () => void, ms: number): void;
}

export class StandInSender implements Sender {
  constructor(
    readonly file: string,
    readonly name: string,
    readonly clock?: StandInClock,
    readonly write?: (file: string, text: string) => void,
  ) {}

  frame(_frame: RawFrame): boolean {
    return false;
  }

  error(): string | null {
    return null;
  }

  stop(): void {
    // Not built yet.
  }
}
