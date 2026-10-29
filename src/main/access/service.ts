import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  type AccessBusy,
  type AccessReason,
  type AccessRequestView,
  type AccessView,
  OFFLINE_DAYS_TEXT,
} from '../../shared/access';
import {
  ACCESS_CHECK_EVERY_MS,
  ACCESS_ERROR_TEXT,
  ACCESS_LIMITS,
  ACCESS_STOP_AFTER_MS,
  type AccessActivity,
  type AccessCheckStatus,
  type AccessGrant,
  type AccessMode,
  type AccessRequestStatus,
  gmailShaped,
  NO_ACTIVITY,
  NO_CONTACT,
  normaliseToken,
} from '../../shared/access-protocol';
import { cutText } from '../../shared/text';
import { readState, type StateRead } from '../state-file';
import type { AccessResult, KeptCheck, SignedAnswer } from './client';
import { accessState, type AccessState, isLetIn, setAccessState } from './gate';
import type { ComputerIdResult } from './identity';
import { grantOf, type KeptAnswer, type StoredAccess, storedAccess } from './store';

/*
 * Whether Drashti may open, and stay open (Session 54, access by Gmail, E2 and E3). The only thing that changes
 * the gate (gate.ts), from the list's signed answers (client.ts):
 *
 * - Before it opens: this computer's access, kept in its data folder (store.ts), is checked with the list. Let in,
 *   Drashti opens; not let in, the lock screen (Request Access, or I Have a Token); no answer, it does not open
 *   (Try Again, and it tries again by itself every 15 s). Access made on another computer (a copied data folder)
 *   is never sent: the lock screen says so, and the list would refuse it anyway.
 * - While open, every 15 s: let in, nothing changes; revoked, rejected or unknown, everything stops at once. No
 *   answer (no internet; the owner's decisions of 28 and 29 Oct 2026): Drashti keeps working, the stream and recording
 *   included, for up to 15 days from the last answer, then it stops as a revoke stops it ('no-contact'), saying to ask
 *   for access again, as the list itself ends a computer's grant after 15 days with no check. The 15 days are the
 *   longer of the time Drashti has run (the main process's monotonic clock) and this computer's clock, never read as
 *   earlier than it has read before: a clock set back gains nothing, and a sleep counts (a Mac's monotonic clock stands
 *   still asleep), so a laptop that sleeps between shows cannot stretch them. A stop is for good: only Quit works.
 * - The line saying so (Session 55, the owner's decision of 29 Oct 2026: no false alarms): only once there has been no
 *   answer for about 2 minutes and three checks in a row have had none, never at the first missed one. The 15 days
 *   still count from the last answer, line or no line, so nothing is looser.
 * - A start within the 15 days of an answer that let this computer in (Session 55): Drashti opens at once and asks the
 *   list in the background, whatever it answers heard as any check's (a revoke, a rejection, an unknown computer or an
 *   ended length stops it at that answer). Only the answer as the list signed it is believed (kept in the data folder,
 *   checked with the list's key): an edited one opens nothing at once. The time since it is the longer of this
 *   computer's clock since the check's own time (signed by the list; never earlier than the clock has read before) and
 *   the time Drashti has run since without an answer, and its length must not have ended by then. Older than 15 days:
 *   the lock screen says to ask for access again ('no-contact'), asking the list by itself. No such answer: it opens
 *   only once the list says let in, as before.
 * - The mode (Session 55, the owner's decision of 29 Oct 2026): each answer says whether this computer's Gmail may use
 *   Pro Mode and Simple Mode (Pro) or Simple Mode only (Simple), kept in the gate (gate.ts) for src/main/mode-keeper.ts,
 *   and kept with the answer for a start without the internet.
 * - The network coming back (Session 55, network-watch.ts): while the list has not answered, it is asked at once rather
 *   than at the next 15 s check, and a check still waiting on the old network is given up; never two checks closer
 *   together than 5 s, however often the network comes and goes, and never while the list answers.
 * - A length of access (the owner's decision of 28 Oct 2026): each answer says when access ends by the list's
 *   clock; the window's bar counts down to it from the answer's own time, on the monotonic clock, and the next
 *   check comes at the end at the latest. Once the list says the length has ended ('expired'), everything stops
 *   as a revoke stops it; at start, the lock screen says so and asks again by itself, so a new length opens it.
 *   The computer's own clock is never asked when access ends.
 * - Its totals (minutes let in, shows, streams, recordings, imports: never content) go with each check.
 * - A self-test (DRASHTI_SELFTEST) never asks the list, and its controls stay locked.
 *
 * Nothing here ever writes the token, the secret or a Gmail into the log.
 */

/** A check's answer, as the service hears it. */
export interface CheckAnswer {
  status: AccessCheckStatus;
  owner: boolean;
  recorded: boolean;
  endsAt: number | null;
  /** Pro or Simple (Session 55). */
  mode: AccessMode;
  /** Why the list ended this computer's grant ('no-contact', Session 55), with unknown; null otherwise. */
  why: string | null;
  /** The check's own time on this computer's clock, as the list echoed it (Session 55); null from a list from before. */
  at: number | null;
}

/** The list's calls this needs: client.ts's AccessClient has them all. */
export interface AccessCalls {
  request(gmail: string, name?: string): Promise<AccessResult<{ status: 'requested'; mailed: boolean }>>;
  status(gmail: string): Promise<AccessResult<{ status: AccessRequestStatus; tokenWaiting: boolean }>>;
  redeem(gmail: string, token: string): Promise<AccessResult<{ grant: AccessGrant; owner: boolean }>>;
  /** `stop` gives it up before its time limit (the network came back while it waited on the old one). */
  check(grant: AccessGrant, activity: AccessActivity, stop?: AbortSignal): Promise<AccessResult<CheckAnswer>>;
  /**
   * A check's answer kept in the data folder, read again (Session 55): believed only when the list signed it for this
   * computer. Without it, nothing kept is believed, and a start waits for the list.
   */
  readKept?(kept: SignedAnswer): KeptCheck | null;
}

/** Where this computer's access is kept: store.ts's AccessStore. */
export interface AccessKept {
  read(retryMs?: number): StateRead<StoredAccess>;
  save(value: StoredAccess): void;
  add(more: Partial<AccessActivity>): AccessActivity;
  /** The list's answer to a check, kept for a start without the internet. */
  heard(answer: KeptAnswer): void;
  /** How long Drashti has run since the last answer with none after it. */
  offline(ms: number): void;
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
  /** The main process's monotonic clock (ms): the hour without an answer, and the minutes let in. */
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
  /** Tests only (a test switch): checks this often, the stop this long after the last answer (15 days), the line this long after. */
  checkEveryMs?: number;
  stopAfterMs?: number;
  barAfterMs?: number;
}

/** How often the lock screen asks what became of a request while it waits. */
export const ASK_EVERY_MS = 30_000;
/** The line's time left is said again when the stop has moved more than this (a sleep, or a clock set on, counted). */
const SAID_AGAIN_MS = 5_000;
/** A stop not due yet when its time came (the two clocks apart) is looked at again after at least this. */
const DEADLINE_AGAIN_MS = 1_000;
/** …and at least this often while it waits (a timer never longer than a day: well under setTimeout's 24.8 days). */
const DEADLINE_LOOK_MS = 24 * 60 * 60_000;
/** A minute let in, added to the totals. */
const MINUTE_MS = 60_000;
/** At the end of a length, the check comes this long after it: the list's clock has passed it by then. */
const END_MARGIN_MS = 1_000;
/**
 * The bar comes only once there has been no answer this long (Session 55, the owner's decision of 29 Oct 2026: about
 * 2 minutes, so a check now and then that misses on a network that works says nothing)…
 */
export const BAR_AFTER_MS = 2 * 60_000;
/** …and only once this many checks in a row have had none: never at the first missed one. */
export const BAR_AFTER_MISSES = 3;
/** Never two checks closer together than this, however often the network comes back: the list's own gap. */
export const EARLY_GAP_MS = ACCESS_LIMITS.checkGapMs;
/** The network coming back is said in the log at most this often. */
const BACK_SAID_EVERY_MS = 60_000;

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
      // Its own words, for the log only (why()): a no-answer's detail is never shown.
      detail: error instanceof Error ? error.message : String(error),
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
          `Access: the last check’s time could not be kept in the data folder (${error instanceof Error ? error.message : String(error)})`,
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

/** An answer that this computer's grant ended for no check in 15 days (Session 55): said with unknown. */
const noContact = (v: { status: AccessCheckStatus; why: string | null }): boolean =>
  v.status === 'unknown' && v.why === NO_CONTACT;

/** Why a call came to nothing, for the log (never what was sent). */
function why(r: Extract<AccessResult<unknown>, { ok: false }>): string {
  return r.kind === 'refused' ? `refused: ${r.error}` : `${r.reason}: ${r.detail}`;
}

export class AccessService {
  private kept: StoredAccess | null = null;
  private activity: AccessActivity = { ...NO_ACTIVITY };
  /**
   * When the list last answered let in: on the monotonic clock, and on this computer's clock as high as it has read
   * (wall()). The time since is the longer of the two (sinceAnswer): a clock set back gains nothing, a sleep counts.
   */
  private answered: { mono: number; wall: number } | null = null;
  /** The highest this computer's clock has read (never lower: a clock set back gains nothing). */
  private highWall = 0;
  /** At start, the answer kept let it in, but its 15 days are up: with no answer, the lock says to ask again. */
  private overdue = false;
  private busy: AccessBusy | null = null;
  private message: Message = null;
  private request: AccessRequestView | null = null;
  /**
   * When access ends, as the list's last signed answer said it: the end by the list's clock (for its date), and how
   * long was left then (the end less the answer's serverTime), from that moment on the monotonic clock.
   */
  private ends: { endsAt: number; left: number; at: number } | null = null;
  /** Checks in a row with no answer since the last answer, in this run. */
  private misses = 0;
  /** When the stop comes with no answer (monotonic), as last worked out: 15 days after the last answer. */
  private stopsAt: number | null = null;
  /** The check on its way: when it began, and how to give it up. */
  private inFlight: { started: number; give: AbortController } | null = null;
  /** When the last check began (monotonic): never another within EARLY_GAP_MS of it when the network comes back. */
  private lastStart: number | null = null;
  /** The network came back while the list had not answered: the list is asked again as soon as the gap allows. */
  private early: { why: string } | null = null;
  /** When the network coming back was last said in the log. */
  private backSaid = Number.NEGATIVE_INFINITY;
  /** When start() ran (monotonic): how long the start waited for the list, in the log. */
  private startedAt = 0;
  /** The checks made in this run, counted for the log ("Access: check 1: let in (14 ms)"). */
  private checksMade = 0;
  private readonly timers = new Map<
    'check' | 'deadline' | 'minute' | 'ask' | 'retry' | 'early',
    () => void
  >();
  private readonly listeners = new Set<(view: AccessView) => void>();
  private disposed = false;

  constructor(private readonly o: AccessServiceOptions) {}

  /** This computer's clock, never read as earlier than it has read before (a clock set back gains nothing). */
  private wall(): number {
    this.highWall = Math.max(this.highWall, this.o.now());
    return this.highWall;
  }

  /** The list answered let in now. */
  private heardNow(): void {
    this.answered = { mono: this.o.monotonic(), wall: this.wall() };
  }

  /**
   * How long since the last answer that let this computer in: the longer of the time run (the monotonic clock) and this
   * computer's clock (a sleep counts on either: a Mac's monotonic clock stands still asleep, its clock does not).
   */
  private sinceAnswer(): number {
    const a = this.answered;
    if (!a) return 0;
    return Math.max(0, this.o.monotonic() - a.mono, this.wall() - a.wall);
  }

  private get every(): number {
    return this.o.checkEveryMs ?? ACCESS_CHECK_EVERY_MS;
  }

  private get stopAfter(): number {
    return this.o.stopAfterMs ?? ACCESS_STOP_AFTER_MS;
  }

  private get barAfter(): number {
    return this.o.barAfterMs ?? BAR_AFTER_MS;
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
      endsAt: this.ends?.endsAt ?? null,
      endsInMs: this.endsInMs(),
      mode: s.mode,
    };
  }

  /** Hear every change the windows should show; returns a way to stop hearing. */
  onView(listener: (view: AccessView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** At start: what is kept, checked with the list before anything opens (or at once, within the 15 days). */
  start(): void {
    this.startedAt = this.o.monotonic();
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
    // The latest time a signed call carried: this computer's clock is never read as earlier than it.
    this.highWall = Math.max(this.highWall, read.value.lastAt);
    if (!this.madeHere()) {
      this.o.log('warn', 'Access: the access in this data folder was made on another computer: not sent');
      this.lock('copied');
      return;
    }
    if (this.openAtOnce()) return;
    this.set({ phase: 'checking', gmail: read.value.gmail, owner: false, reason: null, stopsAt: null });
    void this.checkToOpen();
  }

  /**
   * The computer's network came back (network-watch.ts: online again, on another network, or awake again; Session
   * 55). While the list has not answered (a check missed or still on its way, or the lock screen with no answer), it
   * is asked at once rather than at the next 15 s check, a check still waiting on the old network given up once it is
   * 5 s old; never two checks closer together than 5 s, however often the network comes and goes, and nothing at all
   * while the list answers.
   */
  networkBack(why: string): void {
    if (!this.troubled()) return;
    this.early = { why };
    this.earlyLater();
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
    this.inFlight?.give.abort();
  }

  // ---- the checks ------------------------------------------------------------------------------------------

  /** Asked before Drashti opens (and by Try Again, and after a token is used): let in, or the lock screen. */
  private async checkToOpen(): Promise<void> {
    const kept = this.kept;
    const calls = this.o.calls;
    if (!kept || !calls || this.busy !== null || this.inFlight) return;
    this.cancel('retry');
    this.busy = 'checking';
    this.changed();
    const r = await this.ask(calls, kept);
    this.busy = null;
    if (this.disposed || isLetIn() || accessState().phase === 'stopped') return;
    if (r.ok) {
      const { status, owner, endsAt, mode } = r.value;
      this.keepAnswer(r.value, r.serverTime, r.signed);
      if (status === 'in' || status === 'expired') this.heardEnds(endsAt, r.serverTime);
      if (status === 'in') {
        this.letIn(owner, mode);
        this.afterCheck();
        return;
      }
      // Ended by the list for no check in 15 days: the lock says to ask for access again (Session 55).
      const reason = noContact(r.value) ? 'no-contact' : status;
      this.o.log('warn', `Access: not let in (${reason})`);
      this.message = null;
      this.overdue = false;
      this.lock(reason);
      // Its length ended: asked again by itself, so once the owner gives a new length, Drashti opens.
      if (status === 'expired') this.retryLater();
      this.afterCheck();
      return;
    }
    // No answer within the 15 days of one that let it in never reaches here: such a start opened at once (openAtOnce).
    this.o.log('warn', `Access: no answer from the access list, so Drashti does not open (${why(r)})`);
    this.message = r.kind === 'refused' ? { tone: 'warning', text: ACCESS_ERROR_TEXT[r.error] } : null;
    // Its 15 days without an answer up (Session 55): the lock says to ask for access again, as the list will have ended
    // this computer's grant; it still asks by itself, and the list's answer decides.
    this.lock(this.overdue ? 'no-contact' : 'no-answer');
    // As Try Again, by itself: once the connection is back, Drashti opens (at once when the network comes back).
    this.retryLater();
    this.afterCheck();
  }

  /**
   * A start within the 15 days of an answer that let this computer in (Session 55, the owner's decisions of 29 Oct
   * 2026): Drashti opens at once, in the mode that answer gave, and asks the list now, in the background
   * (checkWhileOpen). Its answer is heard as any check's: a revoke, a rejection, an unknown computer or an ended length
   * stops everything at that answer; let in, the 15 days count from it; no answer, they count on from the answer kept
   * here, and the stop comes at their end whatever the checks do (armDeadline), as when the internet goes while Drashti
   * is open.
   */
  private openAtOnce(): boolean {
    const kept = this.kept;
    const known = this.keptLetIn();
    if (!kept || !known) return false;
    const { since, answer: a } = known;
    const now = this.o.monotonic();
    this.answered = { mono: now - since, wall: this.wall() - since };
    this.ends =
      a.endsAt === null ? null : { endsAt: a.endsAt, left: a.endsAt - a.serverTime, at: now - since };
    this.message = null;
    this.request = null;
    this.o.log(
      'info',
      `Access: let in by the list ${String(Math.round(since / 60_000))} min ago, so Drashti opens at once and asks it now${a.mode === 'simple' ? ' (Simple access)' : ''}`,
    );
    this.set({ phase: 'in', gmail: kept.gmail, owner: a.owner, reason: null, stopsAt: null, mode: a.mode });
    if (this.disposed) return true;
    this.armDeadline();
    this.countMinutes();
    void this.checkWhileOpen();
    return true;
  }

  /**
   * The last answer kept here, when it let this computer in less than 15 days ago and its length had not ended by then:
   * how long ago, and what it said. Only the answer as the list signed it is believed (its status, owner, end and
   * mode), read again with the list's key: an answer edited in the data folder, or one kept by a Drashti from before
   * (unsigned), opens nothing at once. The time since it is the longer of this computer's clock since the check's own
   * time, as the list signed it (never read as earlier than the latest `at` sent: a clock set back changes nothing) and
   * the time Drashti has run since without an answer (kept as it runs). An answer that let it in but whose 15 days are
   * up marks the start overdue: with no answer, the lock says to ask for access again.
   */
  private keptLetIn(): { since: number; answer: KeptCheck } | null {
    const kept = this.kept;
    const signed = kept?.answer?.signed;
    const readKept = this.o.calls?.readKept?.bind(this.o.calls);
    if (!kept || !signed || !readKept) return null;
    const a = readKept(signed);
    if (!a) {
      this.o.log(
        'warn',
        'Access: the answer kept in the data folder is not the list’s own: Drashti asks the list first',
      );
      return null;
    }
    if (a.status !== 'in') return null;
    const sent = a.at ?? kept.answer?.heardAt ?? 0;
    const byClock = Math.max(this.o.now(), kept.lastAt, sent) - sent;
    const since = Math.max(byClock, kept.offlineMs ?? 0);
    if (since >= this.stopAfter) {
      this.overdue = true;
      this.o.log('info', 'Access: the last answer that let this computer in is 15 days old or more');
      return null;
    }
    if (a.endsAt !== null && a.serverTime + since >= a.endsAt) return null;
    return { since, answer: a };
  }

  /**
   * One check, on its way until it answers, runs out of time, or is given up (the network came back meanwhile). Each
   * says in the log what came of it and how long it took (Session 55, question 36: the CI Mac's starts that took one
   * check's round longer), never what was sent: "Access: check 1: let in (14 ms)".
   */
  private async ask(calls: AccessCalls, kept: StoredAccess): ReturnType<AccessCalls['check']> {
    const started = this.o.monotonic();
    const give = new AbortController();
    this.inFlight = { started, give };
    this.lastStart = started;
    const n = (this.checksMade += 1);
    try {
      const r = await safely(() => calls.check(grantOf(kept), this.activity, give.signal));
      // Quitting: nothing more is said.
      if (this.disposed) return r;
      const ms = String(Math.round(this.o.monotonic() - started));
      if (r.ok)
        this.o.log(
          r.value.status === 'in' ? 'info' : 'warn',
          `Access: check ${String(n)}: ${r.value.status === 'in' ? 'let in' : r.value.status} (${ms} ms)`,
        );
      else
        this.o.log(
          'warn',
          `Access: check ${String(n)}: ${r.kind === 'refused' ? `refused (${r.error}` : `no answer (${why(r)}`}; ${ms} ms)`,
        );
      return r;
    } finally {
      // Still this one's (a later check may have begun meanwhile, after this one was given up).
      if (this.onItsWay()?.give === give) this.inFlight = null;
    }
  }

  /** The check on its way now (read afresh: it changes while a check waits). */
  private onItsWay(): { started: number; give: AbortController } | null {
    return this.inFlight;
  }

  /**
   * The list's answer, kept in the data folder for a start without the internet (the time run without one, back to
   * none): as the list signed it, which is what a start believes, and its mode with it.
   */
  private keepAnswer(v: CheckAnswer, serverTime: number, signed: SignedAnswer | undefined): void {
    try {
      this.o.kept.heard({
        status: v.status,
        owner: v.owner,
        endsAt: v.endsAt,
        serverTime,
        heardAt: this.o.now(),
        mode: v.mode,
        ...(signed ? { signed } : {}),
      });
    } catch (error) {
      this.o.log(
        'warn',
        `Access: the list’s answer could not be kept in the data folder (${(error as Error).message})`,
      );
    }
  }

  /** The time run since the last answer with none after it, kept in the data folder. */
  private keepOffline(ms: number): void {
    try {
      this.o.kept.offline(ms);
    } catch (error) {
      this.o.log(
        'warn',
        `Access: the time without an answer could not be kept in the data folder (${(error as Error).message})`,
      );
    }
  }

  /** The access kept here asked about again in 15 s, by itself (as Try Again). */
  private retryLater(): void {
    this.cancel('retry');
    this.timers.set(
      'retry',
      this.o.setTimer(this.every, () => {
        this.timers.delete('retry');
        void this.checkToOpen();
      }),
    );
  }

  /**
   * When access ends, from a signed answer: the end, and how long was left by the list's own clock (its serverTime),
   * counted on from now on the monotonic clock. Whether the end changed.
   */
  private heardEnds(endsAt: number | null, serverTime: number): boolean {
    const before = this.ends?.endsAt ?? null;
    this.ends = endsAt === null ? null : { endsAt, left: endsAt - serverTime, at: this.o.monotonic() };
    return before !== endsAt;
  }

  /** How long until access ends, as of now (never below 0); null for no end. */
  private endsInMs(): number | null {
    return this.ends ? Math.max(0, this.ends.left - (this.o.monotonic() - this.ends.at)) : null;
  }

  private letIn(owner: boolean, mode: AccessMode): void {
    this.cancel('ask');
    this.cancel('retry');
    this.heardNow();
    this.overdue = false;
    this.misses = 0;
    this.message = null;
    this.request = null;
    // How long after the start (Session 55: the CI Mac's slow starts, question 36; a token typed counts its minutes).
    this.o.log(
      'info',
      `${owner ? 'Access: let in, as the owner' : 'Access: let in'}${mode === 'simple' ? ', Simple access' : ''} (${String(Math.round(this.o.monotonic() - this.startedAt))} ms after the start)`,
    );
    this.set({ phase: 'in', gmail: this.kept?.gmail ?? null, owner, reason: null, stopsAt: null, mode });
    if (this.disposed) return;
    this.armDeadline();
    this.checkIn(this.nextCheckIn(this.o.monotonic()));
    this.countMinutes();
  }

  private checkIn(ms: number): void {
    this.cancel('check');
    this.timers.set(
      'check',
      this.o.setTimer(ms, () => {
        this.timers.delete('check');
        void this.checkWhileOpen();
      }),
    );
  }

  /** Every 15 s while open (and at once at a start within the 15 days, or when the network comes back). */
  private async checkWhileOpen(): Promise<void> {
    const kept = this.kept;
    const calls = this.o.calls;
    if (!kept || !calls || !this.open() || this.inFlight) return;
    this.cancel('check');
    const started = this.o.monotonic();
    const r = await this.ask(calls, kept);
    // Stopped meanwhile (the 15 days ran out while it waited): nothing it says opens it again.
    if (!this.open()) return;
    if (r.ok) {
      const { status, owner, endsAt, mode } = r.value;
      this.keepAnswer(r.value, r.serverTime, r.signed);
      if (status !== 'in') {
        // Its length ended: stopped as a revoke stops it (the stop says when it ended).
        if (status === 'expired') this.heardEnds(endsAt, r.serverTime);
        // Ended by the list for no check in 15 days (Session 55): the stop says to ask for access again.
        this.stop(noContact(r.value) ? 'no-contact' : status);
        return;
      }
      this.heardNow();
      const missed = this.misses;
      this.misses = 0;
      // The 15 days count again from this answer.
      this.armDeadline();
      const changed = this.heardEnds(endsAt, r.serverTime);
      const s = accessState();
      if (missed > 0)
        this.o.log(
          'info',
          `Access: the access list answers again, after ${String(missed)} ${missed === 1 ? 'check' : 'checks'} with no answer`,
        );
      if (changed) this.o.log('info', endsAt === null ? 'Access: no end now' : 'Access: a new end');
      // A change of mode at this answer (Session 55): Simple holds it in Simple Mode within one check.
      if (s.mode !== mode)
        this.o.log('info', mode === 'simple' ? 'Access: Simple access now' : 'Access: Pro access now');
      if (s.phase !== 'in' || s.owner !== owner || s.mode !== mode)
        this.set({ phase: 'in', owner, reason: null, stopsAt: null, mode });
      // A new end (a new length, or Unlimited): the windows' bar counts down to it afresh. Otherwise each window counts
      // down on its own monotonic clock from what it was told.
      else if (changed) this.changed();
    } else {
      this.noAnswer(r);
      if (!isLetIn()) return;
    }
    this.checkIn(this.nextCheckIn(started));
    this.afterCheck();
  }

  /** How long until the next check: 15 s after the last began, or a moment after the length ends if that is sooner. */
  private nextCheckIn(started: number): number {
    const now = this.o.monotonic();
    let due = started + this.every;
    if (this.ends) due = Math.min(due, Math.max(now, this.ends.at + this.ends.left) + END_MARGIN_MS);
    return Math.max(0, due - now);
  }

  /**
   * No answer (or one that says neither in nor out): Drashti keeps working, and 15 days after the last answer, the
   * stop ('no-contact': as a revoke, saying to ask for access again). The line saying for how long comes only once
   * there has been no answer for about 2 minutes and three checks in a row have had none (Session 55: never at the
   * first). A length that ends meanwhile, by the last answer's own time, stops it at its end.
   */
  private noAnswer(r: Extract<AccessResult<unknown>, { ok: false }>): void {
    const now = this.o.monotonic();
    if (this.ends && this.endsInMs() === 0) {
      this.o.log('warn', `Access: no answer from the access list (${why(r)}), and its length has ended`);
      this.stop('expired');
      return;
    }
    const since = this.sinceAnswer();
    const left = this.stopAfter - since;
    if (left <= 0) {
      this.o.log('warn', `Access: no answer from the access list for ${OFFLINE_DAYS_TEXT} (${why(r)})`);
      this.stop('no-contact');
      return;
    }
    const stopsAt = now + left;
    this.keepOffline(since);
    this.misses += 1;
    // The line up: kept right if the stop has moved (a sleep, or a clock set on, counted).
    if (accessState().phase === 'warning') {
      const was = this.stopsAt;
      this.stopsAt = stopsAt;
      if (was === null || Math.abs(was - stopsAt) > SAID_AGAIN_MS) {
        this.armDeadline();
        this.set({ stopsAt });
      }
      return;
    }
    if (this.misses === 1)
      this.o.log(
        'warn',
        `Access: no answer from the access list (${why(r)}): Drashti keeps working, and says so once none has come for ${String(Math.round(this.barAfter / 1000))} s`,
      );
    if (this.misses < BAR_AFTER_MISSES || since < this.barAfter) return;
    this.o.log(
      'warn',
      `Access: no answer from the access list for ${String(Math.round(since / 1000))} s, ${String(this.misses)} checks in a row (${why(r)}): Drashti keeps working for ${String(Math.ceil(left / 60_000))} min unless it answers, and says so`,
    );
    this.stopsAt = stopsAt;
    this.set({ phase: 'warning', stopsAt, reason: null });
  }

  /**
   * The stop 15 days after the last answer, on time, whatever the checks do (one may wait on a dead network all that
   * while): armed afresh at each answer, and when it comes, the time since worked out again (a sleep counted, on
   * either clock), so it never comes early, and never late by more than a check's time after a Mac's sleep.
   */
  private armDeadline(atLeast = 0): void {
    if (this.answered === null) return;
    const left = this.stopAfter - this.sinceAnswer();
    this.stopsAt = this.o.monotonic() + left;
    this.cancel('deadline');
    this.timers.set(
      'deadline',
      this.o.setTimer(Math.min(Math.max(atLeast, left), DEADLINE_LOOK_MS), () => {
        this.timers.delete('deadline');
        if (!isLetIn() || this.disposed) return;
        // Not yet (this computer's clock behind the time run, say): looked at again, never more often than a second.
        if (this.sinceAnswer() < this.stopAfter) {
          this.armDeadline(DEADLINE_AGAIN_MS);
          return;
        }
        this.o.log('warn', `Access: no answer from the access list for ${OFFLINE_DAYS_TEXT}`);
        this.stop('no-contact');
      }),
    );
  }

  // ---- the network coming back (Session 55) -------------------------------------------------------------------

  /** Whether the list has not answered: a check missed, one still on its way, or the lock screen with no answer. */
  private troubled(): boolean {
    if (this.disposed || !this.o.calls) return false;
    const s = accessState();
    if (s.phase === 'stopped') return false;
    if (this.inFlight) return true;
    if (isLetIn()) return this.misses > 0;
    return (
      s.phase === 'locked' &&
      (s.reason === 'no-answer' || (s.reason === 'no-contact' && this.overdue)) &&
      this.madeHere()
    );
  }

  /** The list asked again once 5 s have passed since the last check began (at once if they have). */
  private earlyLater(): void {
    const from = this.inFlight?.started ?? this.lastStart;
    const wait = from === null ? 0 : Math.max(0, from + EARLY_GAP_MS - this.o.monotonic());
    this.cancel('early');
    this.timers.set(
      'early',
      this.o.setTimer(wait, () => {
        this.timers.delete('early');
        this.actEarly();
      }),
    );
  }

  /** The network came back: a check still on its way is given up (its end asks again), or the list is asked now. */
  private actEarly(): void {
    const early = this.early;
    if (!early || this.disposed) return;
    if (!this.troubled()) {
      this.early = null;
      return;
    }
    const now = this.o.monotonic();
    // A check begun since (less than 5 s ago) has its 5 s first.
    if (this.inFlight && now - this.inFlight.started < EARLY_GAP_MS) {
      this.earlyLater();
      return;
    }
    const say = now - this.backSaid >= BACK_SAID_EVERY_MS;
    if (say) this.backSaid = now;
    if (this.inFlight) {
      if (say)
        this.o.log(
          'info',
          `Access: the network came back (${early.why}): a check waiting on the old network is given up, and the list asked again`,
        );
      // Its end (no answer) asks again: afterCheck.
      this.inFlight.give.abort();
      return;
    }
    this.early = null;
    if (say) this.o.log('info', `Access: the network came back (${early.why}): the list is asked at once`);
    if (isLetIn()) void this.checkWhileOpen();
    else void this.checkToOpen();
  }

  /** A check has ended: the network came back meanwhile, so the list is asked again if it did not answer. */
  private afterCheck(): void {
    if (this.early) this.earlyLater();
  }

  /** Everything stops, for good: only Quit works. */
  private stop(reason: AccessReason): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    this.early = null;
    this.inFlight?.give.abort();
    // The 15 days without an answer used up: started again without the internet, it never opens on them.
    if (reason === 'no-answer' || reason === 'no-contact') this.keepOffline(this.stopAfter);
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

  private cancel(name: 'check' | 'deadline' | 'minute' | 'ask' | 'retry' | 'early'): void {
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
