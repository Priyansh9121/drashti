/*
 * A speed limit for copies (the node link's media, scheduled backups): a
 * bucket of bytes that fills at the rate, holding up to a quarter of a
 * second's worth, so a copy goes at the rate on average without bursts.
 */

/** Media at a limited rate, shared by every copy going out: a token bucket of bytes. */
export class RateGate {
  private tokens: number;
  private at = performance.now();

  private rate: number;

  constructor(bytesPerSecond: number) {
    this.rate = Math.max(1024, bytesPerSecond);
    this.tokens = this.rate / 4;
  }

  setRate(bytesPerSecond: number): void {
    this.rate = Math.max(1024, bytesPerSecond);
  }

  /** Take `n` bytes: how long to wait before sending them (ms). */
  take(n: number): number {
    const now = performance.now();
    this.tokens = Math.min(this.rate / 4, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }
}
