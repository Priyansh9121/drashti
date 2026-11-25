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
 * once judged an output gets a grace again: the limits are generous so a
 * healthy screen is never reloaded.
 *
 * A slow page is not restarted for good (a23-heartbeat; alpha.22's Release run
 * 45524056204, the Intel build under Rosetta on CI's Mac VM, whose output sent
 * its first report after the grace and was restarted every 15-20 s, below the
 * watchdog's own give-up of more than 5 crashes a minute):
 *
 * - run translated, every output gets a warming page's limit (WARMING_STALE_MS);
 * - each restart of the same output doubles the grace after it, up to
 *   RESTART_GRACE_MAX_MS, until one comes RESTARTS_FORGET_MS after the last.
 *
 * Both only ever wait longer, so nothing is restarted sooner or more often than
 * before, and a page hung for good is still restarted.
 */

/** No report for this long (they come every 2 s): stuck. */
export const REPORT_STALE_MS = 6000;
/**
 * While it warms up its GPU (Session 27), this long: a slow computer's warm-up can keep a page busy for
 * seconds at a time, and an output reloaded for it would only warm up again. Run translated, every output's
 * limit (a23-heartbeat): there a page's code, fonts and first drawing run slowly, and it skips its warm-up, so
 * nothing says it is busy (alpha.22's Release run on CI's Mac VM: an output silent past its 15 s grace twice).
 */
export const WARMING_STALE_MS = 30_000;
/** A report this long after a change, and it still has not painted it: stuck. */
export const BEHIND_MS = 3000;
/** Nothing is judged this soon after an output opens or reloads (fonts, the first snapshot). */
export const OPEN_GRACE_MS = 15_000;
/**
 * The longest grace an output restarted again and again gets (a23-heartbeat): 15 s, then 30 s, then 60 s after each
 * reload. Over four times the slowest first paint after a reload measured (13.5 s: the Intel build under Rosetta on
 * a Mac's loaded efficiency cores; 11.4 s on CI's Mac VM); any longer, a hall screen hung for good would wait over a
 * minute between tries.
 */
export const RESTART_GRACE_MAX_MS = 60_000;
/**
 * A restart this long after the same output's last one starts its count afresh (a23-heartbeat): three times the
 * longest gap between restarts in a row (60 s of grace, 30 s of silence and the reload), so a page restarted again
 * and again keeps its count, and one hang much later in a service gets the first grace again.
 */
export const RESTARTS_FORGET_MS = 5 * 60_000;
/** How often the outputs are looked at. */
export const CHECK_EVERY_MS = 1000;
/** After this many restarts of the same output in a row the operator is told (a23-heartbeat). */
export const RESTARTS_TOLD = 4;

/** The grace after `restarts` restarts of the same output in a row (a23-heartbeat): 15 s, 30 s, then 60 s. */
export function graceAfter(restarts: number): number {
  return Math.min(OPEN_GRACE_MS * 2 ** Math.max(0, restarts), RESTART_GRACE_MAX_MS);
}

interface Seen {
  /** When it opened (or reloaded, or was last judged stuck). */
  since: number;
  reportAt: number | null;
  paintedRev: number;
  /** Still warming up its GPU, unseen (Session 27): it runs, and draws the show only once done. */
  warming: boolean;
  /**
   * Since when its reports have drawn the show without a break (a23-heartbeat, review S1): null until one does, and
   * again after a report a change behind (BEHIND_MS or more) or a gap in its reports longer than its limit.
   */
  drewAt: number | null;
}

export interface HeartbeatDeps {
  now(): number;
  /** The engine's revision now. */
  engineRev(): number;
  /** The outputs to judge now: those visible and showing. */
  judged(): string[];
  /** It is stuck: log it and restart it, the `inARow`th time in a row (a23-heartbeat: 1 for the first). */
  stuck(screenId: string, reason: string, inARow: number): void;
  /**
   * The operator is told (a23-heartbeat): this output was restarted `restarts` times in a row, RESTARTS_TOLD or more;
   * or null, it no longer is.
   */
  told?(screenId: string, restarts: number | null): void;
  /**
   * Drashti runs translated (an Intel build under Rosetta, x64 under Windows' emulation; a23-heartbeat): every
   * output's reports may come as far apart as a warming one's.
   */
  translated?: boolean;
}

export class OutputHeartbeat {
  private readonly seen = new Map<string, Seen>();
  /** Each output's restarts in a row (a23-heartbeat): how many, and when the last one was. */
  private readonly restarts = new Map<string, { count: number; at: number }>();
  /** The outputs the operator is told of, restarted RESTARTS_TOLD times in a row or more (a23-heartbeat). */
  private readonly toldOf = new Set<string>();
  /** When each recent engine revision happened. */
  private readonly revAt = new Map<number, number>();
  private checkedAt: number | null = null;

  constructor(private readonly deps: HeartbeatDeps) {}

  /** An output opened or reloaded: judged again only after the grace. */
  opened(screenId: string): void {
    this.seen.set(screenId, {
      since: this.deps.now(),
      reportAt: null,
      paintedRev: -1,
      warming: false,
      drewAt: null,
    });
  }

  /** Its window closed: one made again for the screen starts afresh, its restarts forgotten. */
  closed(screenId: string): void {
    this.seen.delete(screenId);
    this.restarts.delete(screenId);
    this.untell(screenId);
  }

  /** Tried afresh (a23-heartbeat: Try again, or the watchdog's own try): its restarts forgotten. */
  afresh(screenId: string): void {
    this.restarts.delete(screenId);
    this.untell(screenId);
  }

  /** The operator is told it no longer keeps being restarted, if they were told it did. */
  private untell(screenId: string): void {
    if (this.toldOf.delete(screenId)) this.deps.told?.(screenId, null);
  }

  /** How many times in a row this output was restarted (a23-heartbeat): none once RESTARTS_FORGET_MS passed. */
  restartsInARow(screenId: string): number {
    const r = this.restarts.get(screenId);
    return r && this.deps.now() - r.at < RESTARTS_FORGET_MS ? r.count : 0;
  }

  /** When an output opened (or was last judged) and last reported, for Ready? (Session 55, Part 8); null if unknown. */
  lastSeen(screenId: string): { since: number; reportAt: number | null } | null {
    const s = this.seen.get(screenId);
    return s ? { since: s.since, reportAt: s.reportAt } : null;
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

  /**
   * An output's 2-second report. One still warming up its GPU (a slow computer can take long past the grace)
   * is running, so alive, but not yet drawing the show: it is not judged behind until it does.
   */
  report(screenId: string, paintedRev: number, warming = false): void {
    const now = this.deps.now();
    const s = this.seen.get(screenId) ?? {
      since: now,
      reportAt: null,
      paintedRev: -1,
      warming: false,
      drewAt: null,
    };
    const gap = s.reportAt === null ? null : now - s.reportAt;
    s.reportAt = now;
    s.paintedRev = paintedRev;
    s.warming = warming;
    this.seen.set(screenId, s);
    // Drawing the show (a23-heartbeat): running, and no change behind by BEHIND_MS or more (one younger is in time,
    // review S3). Its streak starts again after a report that is not, or a gap longer than its limit.
    const late = this.lateBy(s);
    const drawing = !warming && (late === null || late < BEHIND_MS);
    if (!drawing || (gap !== null && gap > this.staleLimit(s))) s.drewAt = null;
    if (drawing) s.drewAt ??= now;
    // Said to keep restarting: no longer once it has drawn the show and kept reporting for longer than the longest grace
    // (review S1), so a page that paints after each reload and stops again stays said. Its count is kept, so a page
    // that stops again soon is said to at once.
    if (this.toldOf.has(screenId) && s.drewAt !== null && now - s.drewAt > RESTART_GRACE_MAX_MS)
      this.untell(screenId);
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
    // Its count forgotten, RESTARTS_FORGET_MS with no restart (a23-heartbeat): no longer said to keep restarting.
    for (const screenId of [...this.toldOf]) if (this.restartsInARow(screenId) === 0) this.untell(screenId);
    for (const screenId of this.deps.judged()) {
      const s = this.seen.get(screenId);
      if (!s) {
        this.opened(screenId);
        continue;
      }
      const inARow = this.restartsInARow(screenId);
      if (now - s.since < graceAfter(inARow)) continue;
      const reason = this.why(s, now);
      if (!reason) continue;
      // Judged: a longer grace while it restarts, the longer the more times in a row (a23-heartbeat).
      const count = inARow + 1;
      this.restarts.set(screenId, { count, at: now });
      this.opened(screenId);
      this.deps.stuck(screenId, reason, count);
      // Restarted again and again (a23-heartbeat): the operator is told, so a hall screen reloading is never silent.
      if (count >= RESTARTS_TOLD) {
        this.toldOf.add(screenId);
        this.deps.told?.(screenId, count);
      }
    }
  }

  /** How long a page may go without a report (warming, or run translated: a23-heartbeat). */
  private staleLimit(s: Seen): number {
    return s.warming || this.deps.translated === true ? WARMING_STALE_MS : REPORT_STALE_MS;
  }

  /** How long after the first change it has not painted its last report came; null when it painted them all. */
  private lateBy(s: Seen): number | null {
    if (s.reportAt === null || s.paintedRev >= this.deps.engineRev()) return null;
    const changedAt = this.revAt.get(s.paintedRev + 1);
    return changedAt === undefined ? null : s.reportAt - changedAt;
  }

  private why(s: Seen, now: number): string | null {
    const heardAt = s.reportAt ?? s.since;
    if (now - heardAt > this.staleLimit(s)) return `no report for ${Math.round((now - heardAt) / 1000)} s`;
    if (s.warming) return null;
    // The first change it has not painted, and how long before its last report that came.
    const behind = this.lateBy(s);
    return behind !== null && behind >= BEHIND_MS
      ? `painted revision ${s.paintedRev} of ${this.deps.engineRev()}, ${Math.round(behind / 1000)} s after the change`
      : null;
  }
}
