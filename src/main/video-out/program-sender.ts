import type { spawn } from 'node:child_process';
import type { RawFormat, RawFrame, Sender } from './frames';

/* Red (x30): Drashti's small program for this computer's way, fed each frame, not yet built. */

export const FORMAT_CODES: Record<RawFormat, number> = { I420: 0, NV12: 0, BGRA: 0, RGBA: 0 };

export function frameHeader(_frame: Pick<RawFrame, 'format' | 'width' | 'height'>): Buffer {
  return Buffer.alloc(0);
}

export const PROGRAM_ENDED = 'Not built yet.';

export class ProgramSender implements Sender {
  constructor(
    readonly program: string,
    readonly name: string,
    readonly log: (level: 'info' | 'warn', message: string) => void,
    readonly ended: (message: string) => void,
    readonly start?: typeof spawn,
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
