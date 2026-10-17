/*
 * The stream's page started again after it stopped (a crash), at most 5 times a minute (Session 31,
 * ROB-7): a page that fails every time it starts is then left stopped, with a notice and Try again,
 * instead of being started over and over, as the watchdog does for a hall screen.
 */

export class RestartCap {
  private times: number[] = [];

  constructor(
    private readonly max = 5,
    private readonly windowMs = 60_000,
  ) {}

  /** A restart is wanted at `now`: whether it may happen (an allowed one is counted). */
  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }

  /** Tried again by hand: it starts afresh. */
  reset(): void {
    this.times = [];
  }
}
