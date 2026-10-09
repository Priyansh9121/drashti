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
 */

export type StopFn = () => unknown;

interface Stop {
  name: string;
  stop: StopFn;
}

export class StopList {
  private readonly services: Stop[] = [];
  private readonly last: Stop[] = [];
  private stopped = false;

  constructor(private readonly onError: (name: string, error: unknown) => void) {}

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

  /** Stop everything, once. The names of the stops that failed. */
  run(): string[] {
    if (this.stopped) return [];
    this.stopped = true;
    const failed: string[] = [];
    const fail = (name: string, error: unknown) => {
      failed.push(name);
      this.onError(name, error);
    };
    for (const { name, stop } of [...[...this.services].reverse(), ...this.last]) {
      try {
        const result = stop();
        // Asynchronous stops (closing a worker's server) go on as Drashti quits; a failure is still logged.
        if (result instanceof Promise)
          result.catch((error: unknown) => {
            this.onError(name, error);
          });
      } catch (error) {
        fail(name, error);
      }
    }
    return failed;
  }
}
