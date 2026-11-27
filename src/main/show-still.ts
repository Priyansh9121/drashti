/*
 * A pause in the live commands (alpha.24, source-preparation-responsiveness.spec.ts:101's Mac flake). Reading a deck's
 * own words and shapes (Edit slides, Insert pages…) makes a hidden window for the PDF, or starts a reader for the
 * PowerPoint: the window, its compositor and its process held Main's UI thread 44-270 ms on CI's Mac (the a22-spprobe
 * traces: no task ran there meanwhile), and a Next pressed then waited behind it. Main notes every show command here; a
 * reading starts only once none has come for STILL_MS, or after MAX_WAIT_MS of them, so it never starts in the middle
 * of an operator's run of Next and Back. The reading itself runs in that low-priority process and goes on as before.
 */

/** How long the live commands pause before a reading starts. */
export const STILL_MS = 500;
/** How long a reading waits for that pause at most, the commands still coming. */
export const MAX_WAIT_MS = 5_000;

export interface ShowStillDeps {
  now: () => number;
  /** Runs `run` after `ms`; its result stops it. */
  setTimer: (ms: number, run: () => void) => () => void;
}

const realDeps: ShowStillDeps = {
  now: () => performance.now(),
  setTimer: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

export class ShowStill {
  private last = -Infinity;

  constructor(private readonly deps: ShowStillDeps = realDeps) {}

  /** A show command came now (whoever sent it). */
  noted(): void {
    this.last = this.deps.now();
  }

  /** True once no show command has come for STILL_MS (or MAX_WAIT_MS have passed); false once `signal` aborts. */
  still(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const startedAt = this.deps.now();
    return new Promise<boolean>((resolve) => {
      let stop: (() => void) | null = null;
      const finish = (still: boolean) => {
        stop?.();
        stop = null;
        signal.removeEventListener('abort', aborted);
        resolve(still);
      };
      const aborted = () => {
        finish(false);
      };
      const look = () => {
        stop = null;
        const left = Math.min(this.last + STILL_MS, startedAt + MAX_WAIT_MS) - this.deps.now();
        if (left <= 0) finish(true);
        else stop = this.deps.setTimer(left, look);
      };
      signal.addEventListener('abort', aborted, { once: true });
      look();
    });
  }
}
