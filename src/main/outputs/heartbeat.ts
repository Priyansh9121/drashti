/*
 * Hung and stale outputs (Session 23). The watchdog hears of a hang only from
 * Chromium's "unresponsive", which comes from input the page does not answer,
 * and an output takes no input: a page stuck in a loop showed its last frame
 * for good, with nobody told. Each output already reports every 2 s how it
 * draws and the engine revision it last painted; this watches those reports:
 *
 * - no report for REPORT_STALE_MS: the page is not running;
 * - a report that came BEHIND_MS or more after a change, still not showing
 *   it: the page runs but no longer draws.
 *
 * Either way the output is said to be stuck (the main process logs it and
 * crashes it into the watchdog's reload). Only visible, showing outputs are
 * judged, never in the first OPEN_GRACE_MS after one opens or reloads, and
 * once judged an output gets the same grace again: the limits are generous so
 * a healthy screen is never reloaded.
 */

/** No report for this long (they come every 2 s): stuck. */
export const REPORT_STALE_MS = 6000;
/** A report this long after a change, and it still has not painted it: stuck. */
export const BEHIND_MS = 3000;
/** Nothing is judged this soon after an output opens or reloads (fonts, the first snapshot). */
export const OPEN_GRACE_MS = 15_000;
/** How often the outputs are looked at. */
export const CHECK_EVERY_MS = 1000;

interface Seen {
  /** When it opened (or reloaded, or was last judged stuck). */
  since: number;
  reportAt: number | null;
  paintedRev: number;
}

export interface HeartbeatDeps {
  now(): number;
  /** The engine's revision now. */
  engineRev(): number;
  /** The outputs to judge now: those visible and showing. */
  judged(): string[];
  /** It is stuck: log it and restart it. */
  stuck(screenId: string, reason: string): void;
}

export class OutputHeartbeat {
  private readonly seen = new Map<string, Seen>();
  /** When each recent engine revision happened. */
  private readonly revAt = new Map<number, number>();
  private checkedAt: number | null = null;

  constructor(private readonly deps: HeartbeatDeps) {}

  /** An output opened or reloaded: judged again only after the grace. */
  opened(screenId: string): void {
    this.seen.set(screenId, { since: this.deps.now(), reportAt: null, paintedRev: -1 });
  }

  closed(screenId: string): void {
    this.seen.delete(screenId);
  }

  /** The engine changed (its revision now). */
  changed(rev: number): void {
    this.revAt.set(rev, this.deps.now());
    // Only the recent past matters: a few minutes of changes at most.
    if (this.revAt.size > 2000) {
      const cut = rev - 1000;
      for (const r of this.revAt.keys()) if (r < cut) this.revAt.delete(r);
    }
  }

  /** An output's 2-second report. */
  report(screenId: string, paintedRev: number): void {
    const s = this.seen.get(screenId) ?? { since: this.deps.now(), reportAt: null, paintedRev: -1 };
    s.reportAt = this.deps.now();
    s.paintedRev = paintedRev;
    this.seen.set(screenId, s);
  }

  /** Look at every judged output once (every CHECK_EVERY_MS). */
  check(): void {
    const now = this.deps.now();
    const late = this.checkedAt !== null && now - this.checkedAt > CHECK_EVERY_MS * 2.5;
    this.checkedAt = now;
    // The main process itself was held up (a stall, the computer asleep): what the outputs did not
    // say meanwhile proves nothing. Every output starts its grace again.
    if (late) {
      for (const screenId of this.seen.keys()) this.opened(screenId);
      return;
    }
    for (const screenId of this.deps.judged()) {
      const s = this.seen.get(screenId);
      if (!s) {
        this.opened(screenId);
        continue;
      }
      if (now - s.since < OPEN_GRACE_MS) continue;
      const reason = this.why(s, now);
      if (!reason) continue;
      // Judged: the same grace again while it restarts.
      this.opened(screenId);
      this.deps.stuck(screenId, reason);
    }
  }

  private why(s: Seen, now: number): string | null {
    const heardAt = s.reportAt ?? s.since;
    if (now - heardAt > REPORT_STALE_MS) return `no report for ${Math.round((now - heardAt) / 1000)} s`;
    if (s.reportAt === null || s.paintedRev >= this.deps.engineRev()) return null;
    // The first change it has not painted, and how long before its last report that came.
    const changedAt = this.revAt.get(s.paintedRev + 1);
    if (changedAt === undefined) return null;
    const behind = s.reportAt - changedAt;
    return behind >= BEHIND_MS
      ? `painted revision ${s.paintedRev} of ${this.deps.engineRev()}, ${Math.round(behind / 1000)} s after the change`
      : null;
  }
}
