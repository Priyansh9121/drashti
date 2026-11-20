import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccessErrorCode } from '../../shared/access-protocol';
import { REPORT_LIMITS, type ReportCallReport } from '../../shared/report';

/*
 * Help › Report a Problem…'s outbox (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42): each report in a folder of
 * its own in Drashti's data folder (never in the library's backups): report.json (what the person reviewed, the call's
 * report, and where it stands), data.json (its files' base64 by SHA-256, as the report worker wrote it) and files/.
 *
 * A report Sent goes by itself, once (the list remembers its id: a second try is answered "received" again):
 * - at once if it can; with no answer, again after 1, 5, 15, 30 and 60 minutes (then hourly), and whenever woken (the
 *   network back, the stream ended, this computer let in again);
 * - never while the stream or a recording is on (or starting, or ending: the owner's Q60-42, 3): it waits, and an upload
 *   under way is given up the moment one starts, to go again after;
 * - at most 5 a day from this computer (Q60-42, 4): a sixth waits for the next day (by the list's day, in UTC), as do
 *   the list's own refusals for the day (too-many, mail-limit);
 * - a list that takes no reports yet (bad-request: the owner has not pasted the new script) or answers not-in: tried
 *   every hour, never dropped; refused for good only when no try can change it (too-large).
 * A report prepared for Review and never sent is cleared at the next start. Its words never go into the log.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Why a report waits. */
export type ReportWait = 'unreachable' | 'on-air' | 'tomorrow' | 'list';

export type ReportState =
  | { kind: 'prepared' }
  | { kind: 'sending' }
  | { kind: 'waiting'; why: ReportWait; next: number | null }
  | { kind: 'sent'; reference: string; at: number }
  | { kind: 'refused'; why: AccessErrorCode };

/** A report as its folder keeps it (report.json): what was reviewed, the call's report, and where it stands. */
export interface StoredReport {
  v: 1;
  id: string;
  reference: string;
  /** When its Review was made, and when Send was pressed (null before). */
  prepared: number;
  sentAt: number | null;
  subject: string;
  /** The email's text as the person reviewed it. */
  text: string;
  call: ReportCallReport;
  state: ReportState;
  tries: number;
}

/** How one try went. */
export type SendOutcome =
  | { ok: true; reference: string; again: boolean }
  | { ok: false; kind: 'refused'; error: AccessErrorCode }
  | { ok: false; kind: 'no-answer'; stopped: boolean };

export interface OutboxDeps {
  /** The reports' folder (in the data folder). */
  dir: string;
  /** One try: the report and its files' data (data.json) to the list, signed; given up when `stop` aborts. */
  send(report: StoredReport, data: Buffer, stop: AbortSignal): Promise<SendOutcome>;
  /** This computer is let in (a report is signed with its way in). */
  canSend(): boolean;
  /** The stream or a recording is on (or starting, or ending): reports wait (the owner's Q60-42, 3). */
  onAir(): boolean;
  now(): number;
  setTimer(ms: number, run: () => void): () => void;
  /** After no answer, the waits before the next tries (the last repeats). */
  retryMs?: readonly number[];
  /** After a start, the wait before the first try of the reports kept from before. */
  startDelayMs?: number;
  /** How often the stream's state is looked at while a report waits for it, or goes. */
  pollMs?: number;
  /** The reports changed (the window's list). */
  changed(): void;
  /** A report kept before has reached the admin (the operator window says so). */
  reached(report: StoredReport): void;
  log(line: string): void;
  /** A report's data.json, read (tests: at once). */
  readData?: (file: string) => Promise<Buffer>;
}

const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, HOUR];
/** Reports kept at most: a Send past it is refused, so a stuck window cannot fill the data folder. */
export const REPORTS_KEPT_WAITING = 20;
/** A sent report's folder is removed this long after it went. */
const SENT_KEPT_MS = 30 * DAY;
const ID = /^[0-9a-f]{32}$/u;

/** The list's next day (UTC, as it counts its day), a minute in. */
const nextDay = (now: number) => (Math.floor(now / DAY) + 1) * DAY + 60_000;
const sameDay = (a: number, b: number) => Math.floor(a / DAY) === Math.floor(b / DAY);

export class ReportOutbox {
  private readonly reports = new Map<string, StoredReport>();
  private readonly timers = new Set<() => void>();
  private busy: { id: string; stop: AbortController } | null = null;
  private wakeAt: { at: number; cancel: () => void } | null = null;
  private poll: (() => void) | null = null;
  private readonly firsts = new Map<string, (state: ReportState) => void>();
  private disposed = false;

  constructor(readonly deps: OutboxDeps) {
    this.read();
  }

  /** Every report kept, newest first (a prepared one too: the window's list leaves those out). */
  list(): StoredReport[] {
    return [...this.reports.values()].sort((a, b) => (b.sentAt ?? b.prepared) - (a.sentAt ?? a.prepared));
  }

  /** A report made for Review (its folder written by the report worker): kept, not sent. */
  prepared(report: Omit<StoredReport, 'state' | 'tries' | 'sentAt' | 'v'>): void {
    const stored: StoredReport = { v: 1, ...report, sentAt: null, state: { kind: 'prepared' }, tries: 0 };
    this.reports.set(stored.id, stored);
    this.write(stored);
  }

  /** The report kept (report.json read again), or null. */
  get(id: string): StoredReport | null {
    return this.reports.get(id) ?? null;
  }

  /** Reports sent today from this computer (Q60-42: 5 a day), by the list's day. */
  sentToday(): number {
    const now = this.deps.now();
    return [...this.reports.values()].filter((r) => r.state.kind === 'sent' && sameDay(r.state.at, now))
      .length;
  }

  /** How many wait to go. */
  waiting(): number {
    return [...this.reports.values()].filter((r) => r.state.kind === 'waiting' || r.state.kind === 'sending')
      .length;
  }

  /**
   * Send pressed: the report waits to go, and is tried now if it can be. Resolves with where it stands after that first
   * try, or at once with why it waits.
   */
  send(id: string): Promise<ReportState> {
    const r = this.reports.get(id);
    if (r?.state.kind !== 'prepared')
      return Promise.resolve(r?.state ?? { kind: 'refused', why: 'bad-request' });
    r.sentAt = this.deps.now();
    r.state = { kind: 'waiting', why: 'unreachable', next: this.deps.now() };
    this.write(r);
    const first = new Promise<ReportState>((resolve) => {
      this.firsts.set(id, resolve);
    });
    // Tried now, or told why it waits (another report going first: once that one is done).
    this.pump();
    return first;
  }

  /** The reports kept from before, tried a while after the start (never during it). */
  start(): void {
    for (const r of [...this.reports.values()])
      if (r.state.kind === 'prepared') this.drop(r.id);
      else if (r.state.kind === 'sent' && this.deps.now() - r.state.at > SENT_KEPT_MS) this.drop(r.id);
      else if (r.state.kind === 'sending') r.state = { kind: 'waiting', why: 'unreachable', next: null };
    this.later(this.deps.startDelayMs ?? 2 * 60_000);
  }

  /** The network back, the stream ended, this computer let in again: what waits is tried now. */
  wake(): void {
    for (const r of this.reports.values())
      if (r.state.kind === 'waiting' && (r.state.why === 'unreachable' || r.state.why === 'on-air'))
        r.state = { ...r.state, next: this.deps.now() };
    this.pump();
  }

  /** Remove a report: a waiting one is never sent (one going is given up). */
  remove(id: string): boolean {
    if (!this.reports.has(id)) return false;
    if (this.busy?.id === id) this.busy.stop.abort();
    this.drop(id);
    this.deps.changed();
    return true;
  }

  /** Save a Copy…: the email's text (report.txt) and the files, in a folder of their own in `into`; its path. */
  saveCopy(id: string, into: string): string | null {
    const r = this.reports.get(id);
    if (!r) return null;
    let folder = join(into, `Drashti report ${r.reference}`);
    for (let n = 2; existsSync(folder); n++)
      folder = join(into, `Drashti report ${r.reference} (${String(n)})`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'report.txt'), `Subject: ${r.subject}\n\n${r.text}\n`, 'utf8');
    const files = join(this.deps.dir, id, 'files');
    for (const f of r.call.files) {
      const from = join(files, f.name);
      if (existsSync(from)) copyFileSync(from, join(folder, f.name));
    }
    return folder;
  }

  dispose(): void {
    this.disposed = true;
    this.busy?.stop.abort();
    for (const cancel of this.timers) cancel();
    this.timers.clear();
    this.wakeAt?.cancel();
    this.wakeAt = null;
    this.poll?.();
    this.poll = null;
  }

  // ---- trying ----

  /** The next report due is tried, unless one is going, or none may go now. */
  private pump(): void {
    if (this.disposed || this.busy) return;
    const now = this.deps.now();
    const due = [...this.reports.values()]
      .filter((r) => r.state.kind === 'waiting' && r.state.next !== null && r.state.next <= now)
      .sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
    const r = due[0];
    if (r) {
      if (!this.deps.canSend()) this.wait(r, 'unreachable', null);
      else if (this.deps.onAir()) this.wait(r, 'on-air', null);
      else if (this.sentToday() >= REPORT_LIMITS.perComputerPerDay) this.wait(r, 'tomorrow', nextDay(now));
      else {
        void this.attempt(r);
        return;
      }
      // That one waits: the next due is looked at.
      this.pump();
      return;
    }
    this.schedule();
  }

  /** One try of a report. */
  private async attempt(r: StoredReport): Promise<void> {
    const stop = new AbortController();
    this.busy = { id: r.id, stop };
    r.state = { kind: 'sending' };
    r.tries += 1;
    this.write(r);
    this.deps.changed();
    this.watchAir();
    let outcome: SendOutcome;
    try {
      const file = join(this.deps.dir, r.id, 'data.json');
      const data = await (this.deps.readData ? this.deps.readData(file) : readFile(file));
      outcome = await this.deps.send(r, data, stop.signal);
    } catch (error) {
      this.deps.log(
        `Report ${r.reference}: could not be read to send (${error instanceof Error ? error.message : String(error)})`,
      );
      outcome = { ok: false, kind: 'no-answer', stopped: false };
    }
    this.busy = null;
    this.stopWatching();
    if (this.disposed) return;
    if (!this.reports.has(r.id)) {
      this.pump();
      return;
    }
    const now = this.deps.now();
    const tries = r.tries;
    if (outcome.ok) {
      const kept = tries > 1 || !this.firsts.has(r.id);
      r.state = { kind: 'sent', reference: outcome.reference, at: now };
      this.deps.log(`Report ${r.reference}: received by the access list${outcome.again ? ' (again)' : ''}`);
      if (kept) this.deps.reached(r);
    } else if (outcome.kind === 'no-answer') {
      if (outcome.stopped && this.deps.onAir()) r.state = { kind: 'waiting', why: 'on-air', next: null };
      else {
        const retry = this.deps.retryMs ?? RETRY_MS;
        const wait = retry[Math.min(tries - 1, retry.length - 1)] ?? HOUR;
        r.state = { kind: 'waiting', why: 'unreachable', next: now + wait };
      }
      this.deps.log(`Report ${r.reference}: no answer from the access list; kept`);
    } else if (outcome.error === 'too-many' || outcome.error === 'mail-limit') {
      r.state = { kind: 'waiting', why: 'tomorrow', next: nextDay(now) };
      this.deps.log(
        `Report ${r.reference}: the list takes no more today (${outcome.error}); kept for tomorrow`,
      );
    } else if (outcome.error === 'too-large') {
      r.state = { kind: 'refused', why: outcome.error };
      this.deps.log(`Report ${r.reference}: refused by the access list (${outcome.error})`);
    } else {
      r.state = { kind: 'waiting', why: 'list', next: now + HOUR };
      this.deps.log(
        `Report ${r.reference}: not taken by the access list (${outcome.error}); kept, tried every hour`,
      );
    }
    this.write(r);
    this.settleFirst(r.id);
    this.deps.changed();
    this.pump();
  }

  /** Waiting, for this reason, until `next` (null: until woken). */
  private wait(r: StoredReport, why: ReportWait, next: number | null): void {
    r.state = { kind: 'waiting', why, next };
    this.write(r);
    this.settleFirst(r.id);
    this.deps.changed();
  }

  private settleFirst(id: string): void {
    const resolve = this.firsts.get(id);
    const r = this.reports.get(id);
    if (!resolve || !r) return;
    this.firsts.delete(id);
    resolve(r.state);
  }

  /** The next wake: the soonest report due, or (while one waits on air) the next look at the stream. */
  private schedule(): void {
    const now = this.deps.now();
    const waiting = [...this.reports.values()].filter((r) => r.state.kind === 'waiting');
    const nexts = waiting
      .map((r) => (r.state.kind === 'waiting' ? r.state.next : null))
      .filter((n): n is number => n !== null);
    const onAirWaits = waiting.some((r) => r.state.kind === 'waiting' && r.state.why === 'on-air');
    let at = nexts.length > 0 ? Math.min(...nexts) : Number.POSITIVE_INFINITY;
    if (onAirWaits) at = Math.min(at, now + (this.deps.pollMs ?? 2000));
    if (!Number.isFinite(at)) return;
    if (this.wakeAt && this.wakeAt.at <= at) return;
    this.wakeAt?.cancel();
    const cancel = this.deps.setTimer(Math.max(0, at - now), () => {
      this.wakeAt = null;
      // The stream ended: what waited for it is due now.
      if (!this.deps.onAir())
        for (const r of this.reports.values())
          if (r.state.kind === 'waiting' && r.state.why === 'on-air')
            r.state = { ...r.state, next: this.deps.now() };
      this.pump();
    });
    this.wakeAt = { at, cancel };
  }

  /** While a report goes: the stream starting gives the upload up (it goes again after). */
  private watchAir(): void {
    const look = () => {
      this.poll = null;
      if (!this.busy) return;
      if (this.deps.onAir()) {
        this.busy.stop.abort();
        return;
      }
      this.poll = this.deps.setTimer(this.deps.pollMs ?? 2000, look);
    };
    this.poll = this.deps.setTimer(this.deps.pollMs ?? 2000, look);
  }

  private stopWatching(): void {
    this.poll?.();
    this.poll = null;
  }

  private later(ms: number): void {
    const cancel = this.deps.setTimer(ms, () => {
      this.timers.delete(cancel);
      this.wake();
    });
    this.timers.add(cancel);
  }

  // ---- the folder ----

  private read(): void {
    let names: string[];
    try {
      names = readdirSync(this.deps.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!ID.test(name)) continue;
      try {
        const r = JSON.parse(
          readFileSync(join(this.deps.dir, name, 'report.json'), 'utf8'),
        ) as Partial<StoredReport>;
        if (r.v === 1 && r.id === name) this.reports.set(name, r as StoredReport);
      } catch {
        // Half-made (the start of a Review, cut short): cleared at start.
        this.drop(name);
      }
    }
  }

  private write(r: StoredReport): void {
    const folder = join(this.deps.dir, r.id);
    try {
      mkdirSync(folder, { recursive: true });
      const file = join(folder, 'report.json');
      writeFileSync(`${file}.new`, JSON.stringify(r), 'utf8');
      renameSync(`${file}.new`, file);
    } catch (error) {
      this.deps.log(
        `Report ${r.reference}: could not be kept (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  private drop(id: string): void {
    this.reports.delete(id);
    try {
      rmSync(join(this.deps.dir, id), { recursive: true, force: true });
    } catch {
      // Taken away at the next start.
    }
  }
}
