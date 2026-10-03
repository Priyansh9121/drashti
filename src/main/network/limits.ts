/*
 * Limits on what anyone on the network can ask of Drashti, so a busy or
 * hostile device cannot slow the show: so many requests a second per device
 * or address, and few wrong pairing codes.
 */

/** A token bucket per key: `rate` a second on average, up to `burst` at once. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True when this key may go ahead now (and it is counted). */
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.rate);
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    // Forget keys that have been quiet (full buckets) so the map cannot grow without end.
    if (this.buckets.size > 1000) {
      for (const [k, v] of this.buckets) if (v.tokens >= this.burst) this.buckets.delete(k);
    }
    return ok;
  }
}

/**
 * Wrong pairing codes: each address may get `perAddress` wrong in a minute,
 * and everyone together `overall`; past that, every try is refused until the
 * minute has passed (the right code too), so guessing a code is hopeless.
 */
export class WrongCodeLimiter {
  private readonly wrong = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly perAddress = 5,
    private readonly overall = 30,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private recent(list: number[]): number[] {
    const since = this.now() - this.windowMs;
    return list.filter((t) => t > since);
  }

  /** May this address try a code now? */
  allowed(address: string): boolean {
    const mine = this.recent(this.wrong.get(address) ?? []);
    this.all = this.recent(this.all);
    return mine.length < this.perAddress && this.all.length < this.overall;
  }

  failed(address: string): void {
    const mine = this.recent(this.wrong.get(address) ?? []);
    mine.push(this.now());
    this.wrong.set(address, mine);
    this.all.push(this.now());
    if (this.wrong.size > 1000) {
      for (const [k, v] of this.wrong) if (this.recent(v).length === 0) this.wrong.delete(k);
    }
  }
}
