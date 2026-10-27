import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AccessBusy, AccessReason, AccessRequestView, AccessView } from '../../shared/access';
import {
  ACCESS_CHECK_EVERY_MS,
  ACCESS_ERROR_TEXT,
  ACCESS_STOP_AFTER_MS,
  type AccessActivity,
  type AccessCheckStatus,
  type AccessGrant,
  type AccessRequestStatus,
  gmailShaped,
  NO_ACTIVITY,
  normaliseToken,
} from '../../shared/access-protocol';
import { cutText } from '../../shared/text';
import { readState, type StateRead } from '../state-file';
import type { AccessResult } from './client';
import { accessState, type AccessState, isLetIn, setAccessState } from './gate';
import type { ComputerIdResult } from './identity';
import { grantOf, type StoredAccess, storedAccess } from './store';

/*
 * Whether Drashti may open, and stay open (Session 54, access by Gmail, E2 and E3). The only thing that changes
 * the gate (gate.ts), from the list's signed answers (client.ts):
 *
 * - Before it opens: this computer's access, kept in its data folder (store.ts), is checked with the list. Let in,
 *   Drashti opens; not let in, the lock screen (Request Access, or I Have a Token); no answer, it does not open
 *   (Try Again, and it tries again by itself every 15 s). Access made on another computer (a copied data folder)
 *   is never sent: the lock screen says so, and the list would refuse it anyway.
 * - While open, every 15 s: let in, nothing changes; revoked, rejected or unknown, everything stops at once; no
 *   answer, the countdown, and 2 minutes after the last answer, the same stop. The 2 minutes are on the main
 *   process's monotonic clock: a changed computer clock moves nothing. A stop is for good: only Quit works.
 * - Its totals (minutes let in, shows, streams, recordings, imports: never content) go with each check.
 * - A self-test (DRASHTI_SELFTEST) never asks the list, and its controls stay locked.
 *
 * Nothing here ever writes the token, the secret or a Gmail into the log.
 */

/** The list's calls this needs: client.ts's AccessClient has them all. */
export interface AccessCalls {
  request(gmail: string, name?: string): Promise<AccessResult<{ status: 'requested'; mailed: boolean }>>;
  status(gmail: string): Promise<AccessResult<{ status: AccessRequestStatus; tokenWaiting: boolean }>>;
  redeem(gmail: string, token: string): Promise<AccessResult<{ grant: AccessGrant; owner: boolean }>>;
  check(
    grant: AccessGrant,
    activity: AccessActivity,
  ): Promise<AccessResult<{ status: AccessCheckStatus; owner: boolean; recorded: boolean }>>;
}

/** Where this computer's access is kept: store.ts's AccessStore. */
export interface AccessKept {
  read(retryMs?: number): StateRead<StoredAccess>;
  save(value: StoredAccess): void;
  add(more: Partial<AccessActivity>): AccessActivity;
}

/** The Gmail of the last request made from this computer (not a secret), so the next start can say what came of it. */
export interface AccessAsked {
  read(): string | null;
  write(gmail: string | null): void;
}

export type ActivityKind = Exclude<keyof AccessActivity, 'minutes'>;

export interface AccessServiceOptions {
  /** The list's calls; null when this Drashti has no list to ask (built without its address). */
  calls: AccessCalls | null;
  kept: AccessKept;
  asked: AccessAsked;
  /** This computer's id (identity.ts), or why it has none. */
  computer: ComputerIdResult;
  /** A self-test: never asks the list; the controls stay locked. */
  selfTest: boolean;
  version: string;
  /** The main process's monotonic clock (ms): the 2 minutes, and the minutes let in. */
  monotonic: () => number;
  /** This computer's clock (ms): only when the token was used, kept with the access. */
  now: () => number;
  /** Run `run` in `ms`; what it returns cancels it. */
  setTimer: (ms: number, run: () => void) => () => void;
  log: (level: 'info' | 'warn', message: string) => void;
  /**
   * False for the performance check's own run (Session 54, E review): it is let in as any start is, and adds nothing
   * to this computer's totals (minutes, shows…).
   */
  counts?: boolean;
  /** Tests only (a test switch): checks this often, and the stop this long after the last answer. */
  checkEveryMs?: number;
  stopAfterMs?: number;
}

/** How often the lock screen asks what became of a request while it waits. */
export const ASK_EVERY_MS = 30_000;
/** A timer this late means the computer slept: none runs that late while it is awake. */
const ASLEEP_MS = 30_000;
/** A minute let in, added to the totals. */
const MINUTE_MS = 60_000;

type Message = AccessView['message'];

/** What a request's status means for the person, on the lock screen. */
function requestWords(status: AccessRequestStatus, tokenWaiting: boolean): NonNullable<Message> {
  switch (status) {
    case 'requested':
      return {
        tone: 'info',
        text: 'Waiting for the person who approves access. When they approve, your token comes to your email.',
      };
    case 'approved':
      return tokenWaiting
        ? {
            tone: 'success',
            text: 'Approved. Your token is in your email: type it under I Have a Token, with your Gmail.',
          }
        : {
            tone: 'warning',
            text: 'Approved, but no token is waiting (it was used, or it ran out). Ask the person who approves access to give access again.',
          };
    case 'rejected':
      return { tone: 'danger', text: 'Your request for access was not approved.' };
    case 'revoked':
      return { tone: 'danger', text: 'Your access to Drashti has been removed.' };
    case 'unknown':
      return {
        tone: 'warning',
        text: 'The access list has no request from this computer for that Gmail. Ask for access again.',
      };
  }
}

const NO_INTERNET =
  'No internet: Drashti could not reach the access list. Check the connection, then try again.';

/**
 * A call that throws instead of answering (the data folder could not be written as it was signed, Session 54's E
 * review): never an answer, so it counts as none, and the countdown and the stop run as with no internet. Nothing
 * fails open.
 */
async function safely<T>(call: () => Promise<AccessResult<T>>): Promise<AccessResult<T>> {
  try {
    return await call();
  } catch (error) {
    return {
      ok: false,
      kind: 'no-answer',
      reason: 'network',
      detail: `the call did not go (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/**
 * The time a signed call carries: the one kept in the data folder (never at or below the last sent, whatever this
 * computer's clock does), or, when it cannot be kept (a full disk, a file held by another program), this computer's
 * clock, which the client keeps rising itself. Said once in the log.
 */
export function keptAt(
  store: { nextAt(now: number): number },
  now: () => number,
  log: (line: string) => void,
): () => number {
  let said = false;
  return () => {
    try {
      return store.nextAt(now());
    } catch (error) {
      if (!said) {
        said = true;
        log(
          `Access: the last check's time could not be kept in the data folder (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      return now();
    }
  };
}

/**
 * Where the performance check finds this computer's access (Session 54, E review): in this computer's own data
 * folder, never its throwaway one, so it runs only on a computer let in; in development and the tests, a folder a test
 * let in (DRASHTI_TEST_ACCESS_HOME), which a packaged Drashti never reads.
 */
export function performanceAccessFolder(o: {
  packaged: boolean;
  home: string;
  testFolder: string | undefined;
}): string {
  return !o.packaged && o.testFolder !== undefined && o.testFolder !== '' ? o.testFolder : o.home;
}

/** Why a call came to nothing, for the log (never what was sent). */
function why(r: Extract<AccessResult<unknown>, { ok: false }>): string {
  return r.kind === 'refused' ? `refused: ${r.error}` : `${r.reason}: ${r.detail}`;
}

export class AccessService {
  private kept: StoredAccess | null = null;
  private activity: AccessActivity = { ...NO_ACTIVITY };
  /** When the list last answered let in (monotonic). */
  private lastAnswer: number | null = null;
  /** When the next check is due (monotonic), and up to when a sleep has been counted out. */
  private dueAt = 0;
  private awake = 0;
  private busy: AccessBusy | null = null;
  private message: Message = null;
  private request: AccessRequestView | null = null;
  private readonly timers = new Map<'check' | 'deadline' | 'minute' | 'ask' | 'retry', () => void>();
  private readonly listeners = new Set<(view: AccessView) => void>();
  private disposed = false;

  constructor(private readonly o: AccessServiceOptions) {}

  private get every(): number {
    return this.o.checkEveryMs ?? ACCESS_CHECK_EVERY_MS;
  }

  private get stopAfter(): number {
    return this.o.stopAfterMs ?? ACCESS_STOP_AFTER_MS;
  }

  /** What the windows show. */
  view(): AccessView {
    const s = accessState();
    return {
      phase: s.phase,
      gmail: s.gmail,
      owner: s.owner,
      reason: s.reason,
      stopsInMs:
        s.phase === 'warning' && s.stopsAt !== null ? Math.max(0, s.stopsAt - this.o.monotonic()) : null,
      request: this.request,
      busy: this.busy,
      message: this.message,
      canRetry: s.phase === 'locked' && this.madeHere(),
      version: this.o.version,
    };
  }

  /** Hear every change the windows should show; returns a way to stop hearing. */
  onView(listener: (view: AccessView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** At start: what is kept, checked with the list before anything opens. */
  start(): void {
    const computer = this.o.computer;
    if (this.o.selfTest) {
      this.o.log('info', 'Access: a self-test: the list is never asked, and the controls stay locked');
      this.lock('self-test');
      return;
    }
    if (!computer.ok) {
      this.o.log('warn', `Access: this computer’s own id could not be read (${computer.reason})`);
      this.lock('no-computer-id');
      return;
    }
    if (!this.o.calls) {
      this.o.log(
        'warn',
        'Access: there is no access list to ask (this Drashti was made without its address)',
      );
      this.lock('no-list');
      return;
    }
    const read = this.o.kept.read();
    if (read.status === 'missing') {
      this.o.log('info', 'Access: this computer is not let in yet');
      this.lock(null);
      this.askAgainAtStart();
      return;
    }
    if (read.status !== 'ok') {
      this.o.log('warn', `Access: this computer’s access could not be read (${read.reason})`);
      this.lock('unreadable');
      return;
    }
    this.kept = read.value;
    this.activity = { ...read.value.activity };
    if (!this.madeHere()) {
      this.o.log('warn', 'Access: the access in this data folder was made on another computer: not sent');
      this.lock('copied');
      return;
    }
    this.set({ phase: 'checking', gmail: read.value.gmail, owner: false, reason: null, stopsAt: null });
    void this.checkToOpen();
  }

  /** Request Access: the Gmail's row requested, and the approver emailed. */
  async requestAccess(gmail: string, name: string): Promise<AccessView> {
    const calls = this.mayAct();
    if (!calls) return this.view();
    const g = gmail.trim();
    if (!gmailShaped(g))
      return this.say({ tone: 'warning', text: ACCESS_ERROR_TEXT['bad-gmail'], field: 'gmail' });
    const n = cutText(name.trim(), 60);
    this.busy = 'requesting';
    this.message = null;
    this.changed();
    const r = await safely(() => calls.request(g, n === '' ? undefined : n));
    this.busy = null;
    if (this.disposed) return this.view();
    if (r.ok) {
      this.o.log('info', 'Access: access was asked for from this computer');
      this.request = { gmail: g, status: 'requested', tokenWaiting: false };
      this.remember(g);
      this.message = r.value.mailed
        ? {
            tone: 'success',
            text: 'Asked. The person who approves access has been emailed. When they approve, your token comes to your email: this screen also asks every 30 seconds.',
          }
        : {
            tone: 'warning',
            text: 'Asked, but the access list could not email the person who approves access today. Ask them to look at the access list.',
          };
      this.askLater();
    } else this.message = this.failed(r, 'gmail');
    this.changed();
    return this.view();
  }

  /** What became of the request made from this computer (Check Again, and every 30 s while it waits). */
  async checkRequest(): Promise<AccessView> {
    const calls = this.mayAct();
    const asked = this.request;
    if (!calls || !asked) return this.view();
    this.cancel('ask');
    this.busy = 'asking';
    this.changed();
    const r = await safely(() => calls.status(asked.gmail));
    this.busy = null;
    if (this.disposed || accessState().phase !== 'locked') return this.view();
    if (r.ok) {
      this.request = { gmail: asked.gmail, status: r.value.status, tokenWaiting: r.value.tokenWaiting };
      this.message = requestWords(r.value.status, r.value.tokenWaiting);
      if (r.value.status === 'requested') this.askLater();
      // Told once, plainly: nothing more happens.
      if (r.value.status === 'rejected' || r.value.status === 'unknown') this.remember(null);
      if (r.value.status === 'rejected')
        this.o.log('info', 'Access: the request from this computer was rejected');
    } else {
      this.message = this.failed(r);
      this.askLater();
    }
    this.changed();
    return this.view();
  }

  /** I Have a Token: used once, it lets this computer in for that Gmail until revoked. */
  async redeemToken(gmail: string, typed: string): Promise<AccessView> {
    const calls = this.mayAct();
    const computer = this.o.computer;
    if (!calls || !computer.ok) return this.view();
    const g = gmail.trim();
    if (!gmailShaped(g))
      return this.say({ tone: 'warning', text: ACCESS_ERROR_TEXT['bad-gmail'], field: 'gmail' });
    const token = normaliseToken(typed);
    if (token === null)
      return this.say({
        tone: 'warning',
        text: 'That is not a whole token: it is 28 letters and digits, in groups of four, as your email shows it.',
        field: 'token',
      });
    this.busy = 'redeeming';
    this.message = null;
    this.changed();
    const r = await safely(() => calls.redeem(g, token));
    this.busy = null;
    if (this.disposed) return this.view();
    if (!r.ok) return this.say(this.failed(r, 'token'));
    const kept = storedAccess({
      grant: r.value.grant,
      computerId: computer.id,
      owner: r.value.owner,
      since: this.o.now(),
    });
    try {
      this.o.kept.save(kept);
    } catch (error) {
      // Let in for this run all the same: the token is used, and its secret is here only.
      this.o.log(
        'warn',
        `Access: this computer’s access could not be kept in the data folder (${(error as Error).message}): the next start needs a new token`,
      );
    }
    this.o.log('info', 'Access: a token was used: this computer is let in for its Gmail');
    this.kept = kept;
    this.activity = { ...NO_ACTIVITY };
    this.request = null;
    this.remember(null);
    this.message = null;
    this.set({ gmail: g, reason: null });
    await this.checkToOpen();
    return this.view();
  }

  /** Try Again: the access kept here, checked again (at start, with no answer). */
  async retry(): Promise<AccessView> {
    if (accessState().phase !== 'locked' || !this.madeHere() || this.busy !== null || this.disposed)
      return this.view();
    await this.checkToOpen();
    return this.view();
  }

  /** This computer's way in while it is let in: the owner's calls are signed with it (the Access List, E4). */
  grant(): AccessGrant | null {
    return isLetIn() && this.kept ? grantOf(this.kept) : null;
  }

  /** A show, a stream, a recording or an import, added to this computer's totals (sent with each check). */
  count(kind: ActivityKind, n = 1): void {
    if (this.o.counts === false || !isLetIn() || !this.kept || !(n > 0)) return;
    this.add({ [kind]: Math.floor(n) });
  }

  /** Quitting: nothing more is asked or counted. */
  dispose(): void {
    this.disposed = true;
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  // ---- the checks ------------------------------------------------------------------------------------------

  /** Asked before Drashti opens (and by Try Again, and after a token is used): let in, or the lock screen. */
  private async checkToOpen(): Promise<void> {
    const kept = this.kept;
    const calls = this.o.calls;
    if (!kept || !calls || this.busy !== null) return;
    this.cancel('retry');
    this.busy = 'checking';
    this.changed();
    const r = await safely(() => calls.check(grantOf(kept), this.activity));
    this.busy = null;
    if (this.disposed || isLetIn() || accessState().phase === 'stopped') return;
    if (r.ok) {
      const { status, owner } = r.value;
      if (status === 'in') {
        this.letIn(owner);
        return;
      }
      this.o.log('warn', `Access: not let in (${status})`);
      this.message = null;
      this.lock(status);
      return;
    }
    this.o.log('warn', `Access: no answer from the access list, so Drashti does not open (${why(r)})`);
    this.message = r.kind === 'refused' ? { tone: 'warning', text: ACCESS_ERROR_TEXT[r.error] } : null;
    this.lock('no-answer');
    // As Try Again, by itself: once the connection is back, Drashti opens.
    this.timers.set(
      'retry',
      this.o.setTimer(this.every, () => {
        this.timers.delete('retry');
        void this.checkToOpen();
      }),
    );
  }

  private letIn(owner: boolean): void {
    this.cancel('ask');
    this.cancel('retry');
    this.lastAnswer = this.o.monotonic();
    this.message = null;
    this.request = null;
    this.o.log('info', owner ? 'Access: let in, as the owner' : 'Access: let in');
    this.set({ phase: 'in', gmail: this.kept?.gmail ?? null, owner, reason: null, stopsAt: null });
    this.checkIn(this.every);
    this.countMinutes();
  }

  private checkIn(ms: number): void {
    this.cancel('check');
    this.dueAt = this.o.monotonic() + ms;
    this.timers.set(
      'check',
      this.o.setTimer(ms, () => {
        this.timers.delete('check');
        void this.checkWhileOpen();
      }),
    );
  }

  /** Every 15 s while open. */
  private async checkWhileOpen(): Promise<void> {
    const kept = this.kept;
    const calls = this.o.calls;
    if (!kept || !calls || !this.open()) return;
    this.wokeAfter(this.dueAt);
    const started = this.o.monotonic();
    const r = await safely(() => calls.check(grantOf(kept), this.activity));
    // Stopped meanwhile (the 2 minutes ran out while it waited): nothing it says opens it again.
    if (!this.open()) return;
    if (r.ok) {
      const { status, owner } = r.value;
      if (status !== 'in') {
        this.stop(status);
        return;
      }
      this.lastAnswer = this.o.monotonic();
      this.cancel('deadline');
      const s = accessState();
      if (s.phase === 'warning') this.o.log('info', 'Access: the access list answers again');
      if (s.phase !== 'in' || s.owner !== owner)
        this.set({ phase: 'in', owner, reason: null, stopsAt: null });
    } else {
      this.noAnswer(r);
      if (!isLetIn()) return;
    }
    this.checkIn(Math.max(0, started + this.every - this.o.monotonic()));
  }

  /** No answer (or one that says neither in nor out): the countdown, and at its end the stop. */
  private noAnswer(r: Extract<AccessResult<unknown>, { ok: false }>): void {
    const stopsAt = (this.lastAnswer ?? this.o.monotonic()) + this.stopAfter;
    const left = stopsAt - this.o.monotonic();
    if (left <= 0) {
      this.o.log('warn', `Access: no answer from the access list for 2 minutes (${why(r)})`);
      this.stop('no-answer');
      return;
    }
    if (accessState().phase === 'warning') return;
    this.o.log(
      'warn',
      `Access: no answer from the access list (${why(r)}): Drashti stops in ${String(Math.ceil(left / 1000))} s unless it answers`,
    );
    this.set({ phase: 'warning', stopsAt, reason: null });
    this.armDeadline();
  }

  /** The stop at the end of the countdown, on time; one asleep for a while counts only the time awake. */
  private armDeadline(): void {
    const due = accessState().stopsAt;
    if (due === null) return;
    this.cancel('deadline');
    this.timers.set(
      'deadline',
      this.o.setTimer(Math.max(0, due - this.o.monotonic()), () => {
        this.timers.delete('deadline');
        if (!isLetIn() || this.disposed) return;
        this.wokeAfter(due);
        // Moved on by a sleep: not yet.
        if ((accessState().stopsAt ?? 0) > this.o.monotonic()) {
          this.armDeadline();
          return;
        }
        this.o.log('warn', 'Access: no answer from the access list for 2 minutes');
        this.stop('no-answer');
      }),
    );
  }

  /**
   * A timer due at `due` ran this late: the computer slept (Windows' monotonic clock counts on through a sleep, a
   * Mac's does not). The time asleep is never counted toward the 2 minutes: they go on from the last answer as if
   * the computer had not slept. Each sleep counted once, whichever timer runs first.
   */
  private wokeAfter(due: number): void {
    const late = this.o.monotonic() - Math.max(due, this.awake);
    if (late <= ASLEEP_MS || this.lastAnswer === null) return;
    this.awake = this.o.monotonic();
    this.lastAnswer += late;
    this.o.log(
      'info',
      `Access: the computer slept ${String(Math.round(late / 1000))} s: that time is not counted`,
    );
    const s = accessState();
    if (s.phase === 'warning' && s.stopsAt !== null) {
      this.set({ stopsAt: s.stopsAt + late });
      this.armDeadline();
    }
  }

  /** Everything stops, for good: only Quit works. */
  private stop(reason: AccessReason): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.o.log('warn', `Access: stopped (${reason}): everything stops, and only Quit works`);
    this.set({ phase: 'stopped', owner: false, reason, stopsAt: null });
  }

  private countMinutes(): void {
    if (this.o.counts === false || this.timers.has('minute')) return;
    this.timers.set(
      'minute',
      this.o.setTimer(MINUTE_MS, () => {
        this.timers.delete('minute');
        if (!isLetIn() || this.disposed) return;
        this.add({ minutes: 1 });
        this.countMinutes();
      }),
    );
  }

  private add(more: Partial<AccessActivity>): void {
    try {
      this.activity = this.o.kept.add(more);
    } catch (error) {
      // Counted here all the same, and sent with the next check.
      const next = { ...this.activity };
      for (const k of Object.keys(more) as (keyof AccessActivity)[]) next[k] += more[k] ?? 0;
      this.activity = next;
      this.o.log(
        'warn',
        `Access: the totals could not be kept in the data folder (${(error as Error).message})`,
      );
    }
  }

  // ---- the lock screen --------------------------------------------------------------------------------------

  /** The list's calls, while the lock screen may use them: locked, nothing else on its way. */
  private mayAct(): AccessCalls | null {
    const s = accessState();
    if (this.disposed || s.phase !== 'locked' || this.busy !== null || !this.o.computer.ok) return null;
    if (s.reason === 'self-test' || s.reason === 'no-list' || s.reason === 'no-computer-id') return null;
    return this.o.calls;
  }

  /** A request made before this start: what came of it is asked once more. */
  private askAgainAtStart(): void {
    let gmail: string | null;
    try {
      gmail = this.o.asked.read();
    } catch {
      return;
    }
    if (gmail === null || !gmailShaped(gmail)) return;
    this.request = { gmail, status: 'requested', tokenWaiting: false };
    void this.checkRequest();
  }

  /** The Gmail asked for, kept for the next start (or forgotten); a file that cannot be written only forgets it. */
  private remember(gmail: string | null): void {
    try {
      this.o.asked.write(gmail);
    } catch (error) {
      this.o.log(
        'warn',
        `Access: the request could not be kept in the data folder (${(error as Error).message})`,
      );
    }
  }

  private askLater(): void {
    this.cancel('ask');
    this.timers.set(
      'ask',
      this.o.setTimer(ASK_EVERY_MS, () => {
        this.timers.delete('ask');
        void this.checkRequest();
      }),
    );
  }

  private failed(
    r: Extract<AccessResult<unknown>, { ok: false }>,
    field?: 'gmail' | 'token',
  ): NonNullable<Message> {
    this.o.log('warn', `Access: the access list's answer: ${why(r)}`);
    if (r.kind === 'no-answer') return { tone: 'warning', text: NO_INTERNET };
    const about = r.error === 'bad-gmail' ? 'gmail' : r.error === 'bad-token' ? 'token' : field;
    return { tone: 'warning', text: ACCESS_ERROR_TEXT[r.error], ...(about ? { field: about } : {}) };
  }

  private say(message: NonNullable<Message>): AccessView {
    this.message = message;
    this.changed();
    return this.view();
  }

  // ---- state ---------------------------------------------------------------------------------------------------

  /** Let in, and not quitting. */
  private open(): boolean {
    return isLetIn() && !this.disposed;
  }

  private madeHere(): boolean {
    return this.kept !== null && this.o.computer.ok && this.kept.computerId === this.o.computer.id;
  }

  private lock(reason: AccessReason | null): void {
    this.set({
      phase: 'locked',
      owner: false,
      reason,
      stopsAt: null,
      gmail: this.kept?.gmail ?? accessState().gmail,
    });
  }

  private set(next: Partial<AccessState>): void {
    setAccessState({ ...accessState(), ...next });
    this.changed();
  }

  private changed(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }

  private cancel(name: 'check' | 'deadline' | 'minute' | 'ask' | 'retry'): void {
    this.timers.get(name)?.();
    this.timers.delete(name);
  }
}

// ---- the last request's Gmail, in the data folder ----------------------------------------------------------------

export const ASKED_FILE = 'access-request.json';
const askedSchema = z.object({ gmail: z.string().min(3).max(254) });

/** The Gmail of the last request made from this computer (not a secret: no token, no key), written whole. */
export class AskedFile implements AccessAsked {
  readonly file: string;

  constructor(userData: string) {
    this.file = join(userData, ASKED_FILE);
  }

  read(): string | null {
    const r = readState(this.file, (raw) => {
      const parsed = askedSchema.safeParse(raw);
      return parsed.success ? parsed.data.gmail : null;
    });
    return r.status === 'ok' ? r.value : null;
  }

  write(gmail: string | null): void {
    if (gmail === null) {
      rmSync(this.file, { force: true });
      return;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.writing`;
    writeFileSync(temp, JSON.stringify({ gmail }), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
