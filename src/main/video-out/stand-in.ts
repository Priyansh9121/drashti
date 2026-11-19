import { writeFileSync } from 'node:fs';
import { middleColour, type RawFrame, type Sender } from './frames';

/*
 * The tests' stand-in receiver (DRASHTI_TEST_VIDEO_OUT_STAND_IN, honoured only when Drashti is not packaged): in
 * place of a real receiver, what arrives is written to a file the test reads, at the first frame and then every
 * WRITE_MS at most, the newest always written in the end: how many frames came, their size and format, the middle's
 * colour, and when, by the clock (ms since the epoch).
 */

export interface StandInSeen {
  name: string;
  frames: number;
  width: number;
  height: number;
  format: RawFrame['format'];
  /** The mean colour of the middle of the newest frame, [r, g, b]. */
  middle: [number, number, number];
  at: number;
}

export const WRITE_MS = 100;

export interface StandInClock {
  now(): number;
  later(run: () => void, ms: number): void;
}

const realClock: StandInClock = {
  now: Date.now,
  later: (run, ms) => {
    setTimeout(run, ms).unref();
  },
};

export class StandInSender implements Sender {
  private frames = 0;
  private lastWrite = Number.NEGATIVE_INFINITY;
  /** The newest frame's summary not yet written (a write is due), or null. */
  private waiting: StandInSeen | null = null;
  private stopped = false;

  constructor(
    private readonly file: string,
    private readonly name: string,
    private readonly clock: StandInClock = realClock,
    private readonly write: (file: string, text: string) => void = (file, text) => {
      writeFileSync(file, text);
    },
  ) {}

  frame(frame: RawFrame): boolean {
    if (this.stopped) return false;
    this.frames++;
    const seen: StandInSeen = {
      name: this.name,
      frames: this.frames,
      width: frame.width,
      height: frame.height,
      format: frame.format,
      middle: middleColour(frame),
      at: this.clock.now(),
    };
    const wait = this.lastWrite + WRITE_MS - seen.at;
    if (wait <= 0) {
      this.writeNow(seen);
      return true;
    }
    // Too soon after the last: this one is written when its time comes, unless a newer one comes first.
    const due = this.waiting === null;
    this.waiting = seen;
    if (due)
      this.clock.later(() => {
        const newest = this.waiting;
        this.waiting = null;
        if (newest && !this.stopped) this.writeNow(newest);
      }, wait);
    return true;
  }

  private writeNow(seen: StandInSeen): void {
    this.lastWrite = seen.at;
    this.write(this.file, JSON.stringify(seen));
  }

  error(): string | null {
    return null;
  }

  stop(): void {
    this.stopped = true;
    this.waiting = null;
  }
}
