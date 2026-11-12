/*
 * What Drashti stops as it quits, in one ordered list (Session 23). Each
 * service adds its stop as it is made; at quit the services stop in reverse
 * order (the last made first, so nothing stops before what uses it), each on
 * its own, so one that fails is logged and the rest still stop. Then come the
 * steps that must be last, in the order given: the later writes, the library,
 * the clean-quit mark and an update's install (its installer may close
 * Drashti as it starts).
 *
 * Before, each service had its own `will-quit` listener, run in the order
 * they were registered: the library closed first (its listener was registered
 * before the show started), the stream service then threw reading it, and the
 * throw skipped every quit step after it, the update's install included.
 *
 * Each stop is timed on Drashti's own clock (12 Nov 2026), so a slow quit's
 * log names the stop that was slow: on CI's Windows the stops once took
 * 2,219 ms in all, and nothing said which.
 */

export type StopFn = () => unknown;

interface Stop {
  name: string;
  stop: StopFn;
}

/** How long one stop took as Drashti quit, in ms on Drashti's own clock. */
export interface StopTime {
  name: string;
  ms: number;
}

/** Each stop's time as the log says it, in the order they ran: "events out 0, library 12" (ms, rounded). */
export function stopTimes(times: readonly StopTime[]): string {
  return times.map((t) => `${t.name} ${String(Math.round(t.ms))}`).join(', ');
}

export class StopList {
  private readonly services: Stop[] = [];
  private readonly last: Stop[] = [];
  private stopped = false;
  private readonly took: StopTime[] = [];

  constructor(
    private readonly onError: (name: string, error: unknown) => void,
    /** Drashti's own clock in ms (monotonic): each stop is timed on it. */
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A service: stopped before everything added before it. */
  add(name: string, stop: StopFn): void {
    this.services.push({ name, stop });
  }

  /** A step after every service, in the order these are added (the later writes, the library, the clean-quit mark). */
  addLast(name: string, stop: StopFn): void {
    this.last.push({ name, stop });
  }

  /** Whether the list has run (Drashti is quitting). */
  get done(): boolean {
    return this.stopped;
  }

  /** How long each stop took, in the order they ran (none until the list has run). */
  get times(): readonly StopTime[] {
    return this.took;
  }

  /** Stop everything, once. The names of the stops that failed. */
  run(): string[] {
    if (this.stopped) return [];
    this.stopped = true;
    const failed: string[] = [];
    for (const { name, stop } of [...[...this.services].reverse(), ...this.last]) {
      const started = this.now();
      let threw: { error: unknown } | null = null;
      try {
        const result = stop();
        // Asynchronous stops (closing a worker's server) go on as Drashti quits; a failure is still logged.
        if (result instanceof Promise)
          result.catch((error: unknown) => {
            this.onError(name, error);
          });
      } catch (error) {
        threw = { error };
      }
      // The stop's own time: logging its failure comes after.
      this.took.push({ name, ms: this.now() - started });
      if (threw) {
        failed.push(name);
        this.onError(name, threw.error);
      }
    }
    return failed;
  }
}
