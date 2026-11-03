/*
 * The stream's picture (Session 18): live or recording, the encoder chosen, but no picture from the stream's page
 * (its port went astray, or its capture failed). The page is given a new port, waiting longer each time (5 s, then
 * 10 s, 20 s, to a minute), so a capture that keeps failing is not flooded; a picture resets the wait.
 *
 * The wait counts from the later of the port and the worker's encoder being chosen (Session 55, alpha.14's gate):
 * until the encoder is chosen, no picture can be taken, however soon the page sends one. On CI's Mac the worker took
 * 15 s to choose (VideoToolbox's test encode hung until its 15 s limit, then x264), and those 15 s were counted as no
 * picture, although the page had sent its first frame at once.
 */

/** No picture from the stream's page for this long, while wanted: it is given its port again. */
export const NO_PICTURE_MS = 5000;
/** The longest wait between two new ports. */
const LONGEST_WAIT_MS = 60_000;

export class PictureWatch {
  private pairedAt = 0;
  /** When this worker's first status with its encoder chosen came (null: not yet). */
  private chosenAt: number | null = null;
  private tries = 0;

  constructor(private readonly firstWaitMs = NO_PICTURE_MS) {}

  /** A new worker started (it chooses its encoder afresh). */
  newWorker(): void {
    this.chosenAt = null;
  }

  /** The stream's page was given a new port to the encoder, now. */
  paired(now: number): void {
    this.pairedAt = now;
  }

  /**
   * A status from the worker: `wanted` while live or recording is wanted and the stream's page is ready. Answers the
   * wait that ran out when the page should be given a new port now, else null.
   */
  heard(p: {
    wanted: boolean;
    encoderChosen: boolean;
    encoding: boolean;
    failed: boolean;
    now: number;
  }): number | null {
    if (p.encoderChosen) this.chosenAt ??= p.now;
    if (p.encoding || !p.wanted || !p.encoderChosen || p.failed) {
      if (p.encoding) this.tries = 0;
      return null;
    }
    const wait = Math.min(LONGEST_WAIT_MS, this.firstWaitMs * 2 ** this.tries);
    if (p.now - Math.max(this.pairedAt, this.chosenAt ?? p.now) < wait) return null;
    this.tries++;
    return wait;
  }
}
