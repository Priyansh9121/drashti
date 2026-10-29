import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { placeholderComputer } from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';
import { endsBarShown, offlineLine } from '../../shared/access';
import {
  ACCESS_CHECK_EVERY_MS,
  ACCESS_STOP_AFTER_MS,
  type AccessActivity,
  type AccessCheckStatus,
  type AccessGrant,
  type AccessRequestStatus,
  NO_ACTIVITY,
} from '../../shared/access-protocol';
import { AccessClient, type AccessResult, nodeTransport } from './client';
import { accessState, isLetIn, isOwner, setAccessState } from './gate';
import type { ComputerIdResult } from './identity';
import {
  type AccessAsked,
  type AccessCalls,
  AccessService,
  ASK_EVERY_MS,
  AskedFile,
  BAR_AFTER_MISSES,
  BAR_AFTER_MS,
  EARLY_GAP_MS,
  keptAt,
  performanceAccessFolder,
} from './service';
import { ACCESS_FILE, AccessStore, storedAccess } from './store';

/*
 * Whether Drashti may open and stay open (Session 54, E2 and E3, service.ts): the checks before it opens and
 * every 15 s, the hour without an answer on the monotonic clock with its bar, the stop that only Quit ends, the lock
 * screen's request, token and Try Again, the self-tests that never ask, and a data folder copied from another
 * computer. Mostly against a list scripted here, on a clock the test moves; then once against the stand-in list
 * (the list's own rules) on 127.0.0.1. Placeholder addresses and made-up grants only.
 */

const PERSON = 'placeholder.user@example.com';
const HERE = 'a'.repeat(64);
const SECOND = 1000;
const DAY = 24 * 3_600_000;
/** The scripted list's own clock: its time when the test's monotonic clock reads 0. */
const LIST_START = Date.UTC(2026, 9, 28, 1, 0, 0);
const ELSEWHERE = 'b'.repeat(64);
const GRANT: AccessGrant = { gmail: PERSON, grantId: '1'.repeat(32), secret: '2'.repeat(64) };
// docs/access-setup.md's example token, made at run time: written whole, it reads as a secret to the secret scan.
const TOKEN = ['ABCD', 'EFGH', 'JKMN', 'PQRS', 'TVWX', 'YZ01', '2345'].join('-');

/** A clock the test moves: timers run as their time comes, and what they start is let settle. */
class TestClock {
  t = 50_000;
  wall = Date.UTC(2026, 9, 27, 10, 0, 0);
  private timers: { at: number; run: () => void }[] = [];

  setTimer = (ms: number, run: () => void): (() => void) => {
    const timer = { at: this.t + Math.max(0, ms), run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  };

  /** Move on `ms`, running each timer due on the way, in order. */
  async move(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await settle();
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      // A timer due while the computer slept runs late, at the time it wakes.
      this.t = Math.max(this.t, due.at);
      due.run();
    }
    this.t = end;
    await settle();
  }

  /** The computer asleep for `ms`: no timer runs, and (as Windows' monotonic clock does) the time still passes. */
  sleep(ms: number): void {
    this.t += ms;
  }

  get waiting(): number {
    return this.timers.length;
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

type Mode = AccessCheckStatus | 'silent' | 'busy' | 'throw';

/** The list, scripted: what each call answers, and every call made. */
class ScriptedList implements AccessCalls {
  check_: Mode = 'in';
  owner = false;
  requestAnswer: 'ok' | 'already-approved' | 'silent' = 'ok';
  statusAnswer: AccessRequestStatus = 'requested';
  redeemAnswer: 'ok' | 'bad-token' | 'silent' = 'ok';
  calls: string[] = [];
  activities: AccessActivity[] = [];
  /** A check held until the test lets it answer (or Drashti gives it up). */
  hold: { release: () => void } | null = null;
  /** Checks Drashti gave up while they waited (the network came back). */
  aborted = 0;
  /** When access ends by the list's clock (a length the owner gave), or null for none. */
  endsAt: number | null = null;
  /** The list's own clock: it moves with the test's (never with this computer's own clock). */
  listNow = (): number => LIST_START + clock.t;

  private noAnswer = <T>(): AccessResult<T> => ({
    ok: false,
    kind: 'no-answer',
    reason: 'timeout',
    detail: 'No answer within 20 s.',
  });

  request(): Promise<AccessResult<{ status: 'requested'; mailed: boolean }>> {
    this.calls.push('request');
    if (this.requestAnswer === 'silent') return Promise.resolve(this.noAnswer());
    if (this.requestAnswer === 'already-approved')
      return Promise.resolve({ ok: false, kind: 'refused', error: 'already-approved', message: '' });
    return Promise.resolve({ ok: true, value: { status: 'requested', mailed: true }, serverTime: 0 });
  }

  status(): Promise<AccessResult<{ status: AccessRequestStatus; tokenWaiting: boolean }>> {
    this.calls.push('status');
    return Promise.resolve({
      ok: true,
      value: { status: this.statusAnswer, tokenWaiting: this.statusAnswer === 'approved' },
      serverTime: 0,
    });
  }

  redeem(gmail: string): Promise<AccessResult<{ grant: AccessGrant; owner: boolean }>> {
    this.calls.push('redeem');
    if (this.redeemAnswer === 'silent') return Promise.resolve(this.noAnswer());
    if (this.redeemAnswer === 'bad-token')
      return Promise.resolve({ ok: false, kind: 'refused', error: 'bad-token', message: '' });
    return Promise.resolve({
      ok: true,
      value: { grant: { ...GRANT, gmail }, owner: this.owner },
      serverTime: 0,
    });
  }

  async check(
    _grant: AccessGrant,
    activity: AccessActivity,
    stop?: AbortSignal,
  ): Promise<
    AccessResult<{ status: AccessCheckStatus; owner: boolean; recorded: boolean; endsAt: number | null }>
  > {
    this.calls.push('check');
    this.activities.push({ ...activity });
    if (this.hold) {
      // Waits until the test lets it answer, or Drashti gives it up (as the client does: no answer).
      const givenUp = await new Promise<boolean>((resolve) => {
        this.hold = { release: () => resolve(false) };
        stop?.addEventListener('abort', () => resolve(true), { once: true });
      });
      if (givenUp) {
        this.aborted += 1;
        return { ok: false, kind: 'no-answer', reason: 'network', detail: 'Given up.' };
      }
    }
    if (this.check_ === 'silent') return this.noAnswer();
    // A call that throws (the data folder could not be written as it was signed): never an answer.
    if (this.check_ === 'throw') throw new Error('placeholder: the data folder could not be written');
    if (this.check_ === 'busy') return { ok: false, kind: 'refused', error: 'busy', message: '' };
    // The list's own rule: let in, but past the end of its length by the list's clock, it has ended.
    const now = this.listNow();
    const status =
      this.check_ === 'in' && this.endsAt !== null && now >= this.endsAt ? 'expired' : this.check_;
    return {
      ok: true,
      value: { status, owner: this.owner, recorded: true, endsAt: this.endsAt },
      serverTime: now,
    };
  }

  get checks(): number {
    return this.calls.filter((c) => c === 'check').length;
  }
}

class MemoryAsked implements AccessAsked {
  gmail: string | null = null;
  read = () => this.gmail;
  write = (gmail: string | null) => {
    this.gmail = gmail;
  };
}

let dir = '';
let clock = new TestClock();
let list = new ScriptedList();
let logs: string[] = [];
let service: AccessService | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-access-service-'));
  clock = new TestClock();
  list = new ScriptedList();
  logs = [];
});

afterEach(() => {
  service?.dispose();
  service = null;
  setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null });
  rmSync(dir, { recursive: true, force: true });
});

const store = () => new AccessStore(dir);

/** This computer's access, kept as a used token leaves it. */
function keep(computerId = HERE, activity: AccessActivity = NO_ACTIVITY): void {
  store().save({ ...storedAccess({ grant: GRANT, computerId, owner: false, since: clock.wall }), activity });
}

function make(
  o: {
    computer?: ComputerIdResult;
    selfTest?: boolean;
    calls?: AccessCalls | null;
    asked?: AccessAsked;
    counts?: boolean;
    checkEveryMs?: number;
  } = {},
): AccessService {
  service = new AccessService({
    ...(o.counts === undefined ? {} : { counts: o.counts }),
    ...(o.checkEveryMs === undefined ? {} : { checkEveryMs: o.checkEveryMs }),
    calls: o.calls === undefined ? list : o.calls,
    kept: store(),
    asked: o.asked ?? new MemoryAsked(),
    computer: o.computer ?? { ok: true, id: HERE },
    selfTest: o.selfTest ?? false,
    version: '1.0.0-alpha.13',
    monotonic: () => clock.t,
    now: () => clock.wall,
    setTimer: clock.setTimer,
    log: (level, message) => logs.push(`${level}: ${message}`),
  });
  return service;
}

async function startedIn(): Promise<AccessService> {
  keep();
  const s = make();
  s.start();
  await clock.move(0);
  expect(accessState().phase).toBe('in');
  return s;
}

/** Time passes for the monotonic clock and this computer's own clock alike. */
async function passBoth(ms: number): Promise<void> {
  clock.wall += ms;
  await clock.move(ms);
}

/** Drashti quit, and started again on the same data folder: as start() leaves it, before anything answers. */
function startAgain(): AccessService {
  service?.dispose();
  setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null });
  const s = make();
  s.start();
  return s;
}

describe('before Drashti opens', () => {
  it('checks the access kept here, and opens only once the list says let in', async () => {
    keep();
    list.owner = true;
    const s = make();
    s.start();
    expect(accessState().phase).toBe('checking');
    expect(isLetIn()).toBe(false);
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'in', gmail: PERSON, owner: true, reason: null });
    expect(isOwner()).toBe(true);
    expect(list.calls).toEqual(['check']);
    expect(s.view()).toMatchObject({ phase: 'in', owner: true, busy: null, version: '1.0.0-alpha.13' });
  });

  it('shows the lock screen on a computer never let in, asking nothing', async () => {
    const s = make();
    s.start();
    await clock.move(ACCESS_CHECK_EVERY_MS * 3);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: null });
    expect(list.calls).toEqual([]);
    expect(s.view().canRetry).toBe(false);
  });

  for (const status of ['revoked', 'rejected', 'unknown'] as const)
    it(`does not open when the list answers ${status}, and says why`, async () => {
      keep();
      list.check_ = status;
      make().start();
      await clock.move(0);
      expect(accessState()).toMatchObject({ phase: 'locked', reason: status });
      expect(isLetIn()).toBe(false);
    });

  it('with no answer it does not open: Try Again, and by itself every 15 s, opens once the list answers', async () => {
    keep();
    list.check_ = 'silent';
    const s = make();
    s.start();
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    expect(s.view().canRetry).toBe(true);
    await s.retry();
    expect(accessState().phase).toBe('locked');
    expect(list.checks).toBe(2);
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(3);
    expect(isLetIn()).toBe(false);
    list.check_ = 'in';
    await s.retry();
    expect(accessState().phase).toBe('in');
  });

  it('a refusal that says neither in nor out is no answer too', async () => {
    keep();
    list.check_ = 'busy';
    const s = make();
    s.start();
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    expect(s.view().message?.text).toContain('busy');
  });

  it('a data folder copied from another computer is never sent: the lock screen says so', async () => {
    keep(ELSEWHERE);
    const s = make();
    s.start();
    await clock.move(ACCESS_CHECK_EVERY_MS * 2);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'copied', gmail: PERSON });
    expect(list.calls).toEqual([]);
    expect(s.view().canRetry).toBe(false);
    await s.retry();
    expect(list.calls).toEqual([]);
  });

  it('access that cannot be read, a computer with no id of its own, and no list to ask: locked, saying why', async () => {
    // Cut short, as a disk that failed part-way through would leave it.
    writeFileSync(join(dir, ACCESS_FILE), '{"v":1,"gmail":');
    make().start();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'unreadable' });
    service?.dispose();

    keep();
    make({ computer: { ok: false, reason: 'ioreg gave no IOPlatformUUID' } }).start();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-computer-id' });
    service?.dispose();

    make({ calls: null }).start();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-list' });
    await clock.move(ACCESS_CHECK_EVERY_MS * 2);
    expect(list.calls).toEqual([]);
  });

  it('a self-test never asks the list and never unlocks, even on a computer let in', async () => {
    keep();
    const s = make({ selfTest: true });
    s.start();
    await clock.move(ACCESS_STOP_AFTER_MS * 2);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'self-test' });
    expect(list.calls).toEqual([]);
    await s.retry();
    await s.requestAccess(PERSON, '');
    await s.redeemToken(PERSON, TOKEN);
    expect(list.calls).toEqual([]);
    expect(isLetIn()).toBe(false);
  });
});

describe('while open', () => {
  it('checks every 15 s, and a revoke stops everything at the next check, for good', async () => {
    const s = await startedIn();
    await clock.move(ACCESS_CHECK_EVERY_MS);
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(3);
    list.check_ = 'revoked';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked', owner: false });
    expect(isLetIn()).toBe(false);
    // Nothing is asked any more, and nothing opens it again: only Quit.
    list.check_ = 'in';
    await clock.move(ACCESS_STOP_AFTER_MS * 3);
    expect(list.checks).toBe(4);
    await s.retry();
    await s.redeemToken(PERSON, TOKEN);
    await s.requestAccess(PERSON, '');
    expect(accessState().phase).toBe('stopped');
    expect(list.calls.filter((c) => c !== 'check')).toEqual([]);
    expect(clock.waiting).toBe(0);
  });

  for (const status of ['rejected', 'unknown'] as const)
    it(`stops at once when the list answers ${status}`, async () => {
      await startedIn();
      list.check_ = status;
      await clock.move(ACCESS_CHECK_EVERY_MS);
      expect(accessState()).toMatchObject({ phase: 'stopped', reason: status });
    });

  it('with no answer: no bar at the first missed checks; after 2 minutes, three in a row missed, the bar saying how long it keeps working, gone when the list answers', async () => {
    const s = await startedIn();
    list.check_ = 'silent';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    // One check missed: still let in, the show going on, and nothing said (Session 55: no false alarms).
    expect(accessState()).toMatchObject({ phase: 'in', stopsAt: null });
    expect(isLetIn()).toBe(true);
    expect(s.view().stopsInMs).toBeNull();
    await clock.move(BAR_AFTER_MS - ACCESS_CHECK_EVERY_MS - 1);
    // Seven checks missed, 2 minutes all but a moment: still nothing said.
    expect(list.checks).toBe(8);
    expect(accessState().phase).toBe('in');
    await clock.move(1);
    // 2 minutes with no answer: the bar.
    expect(accessState().phase).toBe('warning');
    expect(isLetIn()).toBe(true);
    const left = s.view().stopsInMs ?? 0;
    expect(left).toBe(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS);
    expect(offlineLine(left)).toBe('Can’t reach the access list: Drashti keeps working for 58 minutes more.');
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(s.view().stopsInMs).toBe(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS - ACCESS_CHECK_EVERY_MS);
    list.check_ = 'in';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'in', stopsAt: null });
    // The hour counts again from this answer, and so do the missed checks: no bar at the first again.
    list.check_ = 'silent';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
    await clock.move(ACCESS_STOP_AFTER_MS - ACCESS_CHECK_EVERY_MS - 1);
    expect(accessState().phase).toBe('warning');
    await clock.move(1);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
  });

  it('stops an hour after the last answer even while a check waits for its answer, and a late answer changes nothing', async () => {
    await startedIn();
    list.check_ = 'silent';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    // One check missed: no bar yet (Session 55), but the hour runs from the last answer all the same.
    expect(accessState().phase).toBe('in');
    // The next check waits (a slow network) past the hour.
    list.hold = { release: () => undefined };
    list.check_ = 'in';
    await clock.move(ACCESS_STOP_AFTER_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
    list.hold.release();
    list.hold = null;
    await clock.move(0);
    expect(accessState().phase).toBe('stopped');
  });

  it('measures the hour on the monotonic clock: a changed computer clock moves nothing', async () => {
    const s = await startedIn();
    list.check_ = 'silent';
    await clock.move(BAR_AFTER_MS);
    // The computer's clock set back a day, then on a week: the stop is still 58 minutes away.
    clock.wall -= 24 * 3_600_000;
    clock.wall += 7 * 24 * 3_600_000;
    expect(s.view().stopsInMs).toBe(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS);
    await clock.move(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS - 1);
    expect(accessState().phase).toBe('warning');
    await clock.move(1);
    expect(accessState().phase).toBe('stopped');
  });

  it('follows the owner flag the list answers', async () => {
    await startedIn();
    expect(isOwner()).toBe(false);
    list.owner = true;
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(isOwner()).toBe(true);
  });

  it('adds a minute each minute let in, and the shows, streams, recordings and imports counted, sent with the checks', async () => {
    keep(HERE, { minutes: 10, shows: 1, streams: 0, recordings: 0, imports: 2 });
    const s = make();
    s.start();
    await clock.move(0);
    expect(list.activities[0]).toEqual({ minutes: 10, shows: 1, streams: 0, recordings: 0, imports: 2 });
    s.count('shows');
    s.count('streams');
    s.count('recordings');
    s.count('imports', 3);
    await clock.move(60_000);
    const last = list.activities[list.activities.length - 1];
    expect(last).toEqual({ minutes: 11, shows: 2, streams: 1, recordings: 1, imports: 5 });
    // Kept in the data folder, for the checks after the next start.
    const kept = JSON.parse(readFileSync(join(dir, ACCESS_FILE), 'utf8')) as { activity: AccessActivity };
    expect(kept.activity).toEqual(last);
    // Nothing is counted once stopped.
    list.check_ = 'revoked';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    s.count('shows');
    await clock.move(5 * 60_000);
    const after = JSON.parse(readFileSync(join(dir, ACCESS_FILE), 'utf8')) as { activity: AccessActivity };
    expect(after.activity).toEqual(last);
  });
});

describe('a length of access (the owner’s decision of 28 Oct 2026)', () => {
  it('says when access ends from the list’s own answer, counted down on the monotonic clock, whatever this computer’s clock says', async () => {
    list.endsAt = list.listNow() + 3 * DAY;
    const s = await startedIn();
    expect(s.view()).toMatchObject({ endsAt: list.endsAt, endsInMs: 3 * DAY });
    expect(endsBarShown(s.view().endsInMs)).toBe(true);
    await clock.move(4 * ACCESS_CHECK_EVERY_MS);
    expect(s.view().endsInMs).toBe(3 * DAY - 4 * ACCESS_CHECK_EVERY_MS);
    // The computer's own clock set back a year, or on a month: nothing moves.
    clock.wall -= 365 * DAY;
    expect(s.view().endsInMs).toBe(3 * DAY - 4 * ACCESS_CHECK_EVERY_MS);
    clock.wall += 30 * DAY;
    expect(s.view().endsInMs).toBe(3 * DAY - 4 * ACCESS_CHECK_EVERY_MS);
    // A length of 30 days: no bar until 7 days before its end.
    list.endsAt = list.listNow() + 30 * DAY;
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(s.view().endsInMs).toBe(30 * DAY - ACCESS_CHECK_EVERY_MS);
    expect(endsBarShown(s.view().endsInMs)).toBe(false);
    // Unlimited: no end at all.
    list.endsAt = null;
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(s.view()).toMatchObject({ endsAt: null, endsInMs: null });
  });

  it('stops at the end as a revoke stops it, its check coming a moment after the end: by the list’s clock, this computer’s a year back', async () => {
    clock.wall -= 365 * DAY;
    // The end falls between two checks (at 30 s and 45 s after the start).
    list.endsAt = list.listNow() + 37_000;
    await startedIn();
    await clock.move(36_000);
    expect(accessState().phase).toBe('in');
    expect(list.checks).toBe(3);
    await clock.move(2_000);
    expect(list.checks).toBe(4);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'expired', owner: false });
    expect(isLetIn()).toBe(false);
    expect(logs).toContain('warn: Access: stopped (expired): everything stops, and only Quit works');
    // For good, as a revoke: nothing is asked any more; only Quit.
    await clock.move(ACCESS_STOP_AFTER_MS * 2);
    expect(list.checks).toBe(4);
    expect(clock.waiting).toBe(0);
  });

  it('a new length given before the end: no stop, and its new end counts down instead', async () => {
    list.endsAt = list.listNow() + 20_000;
    const s = await startedIn();
    await clock.move(ACCESS_CHECK_EVERY_MS);
    // The owner gives 30 days more, from now.
    list.endsAt = list.listNow() + 30 * DAY;
    await clock.move(10_000);
    expect(list.checks).toBe(3);
    expect(accessState().phase).toBe('in');
    expect(s.view().endsAt).toBe(list.endsAt);
    expect(endsBarShown(s.view().endsInMs)).toBe(false);
    expect(logs).toContain('info: Access: a new end');
  });

  it('at start, an ended length keeps it locked and says so, asking again by itself: a new length opens it', async () => {
    list.endsAt = list.listNow() - DAY;
    keep();
    const s = make();
    s.start();
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'expired' });
    expect(s.view()).toMatchObject({ canRetry: true, endsAt: list.endsAt });
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(2);
    expect(accessState().phase).toBe('locked');
    list.endsAt = list.listNow() + 7 * DAY;
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
    expect(s.view().endsInMs).toBe(7 * DAY - ACCESS_CHECK_EVERY_MS);
  });
});

describe('with no internet, Drashti keeps working for up to an hour (the owner’s decision of 28 Oct 2026)', () => {
  const MINUTE = 60_000;

  /** Time passes: the monotonic clock and this computer's own clock alike. */
  async function pass(ms: number): Promise<void> {
    clock.wall += ms;
    await clock.move(ms);
  }

  /** Drashti quit, and started again on the same data folder. */
  async function restart(): Promise<AccessService> {
    service?.dispose();
    setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null });
    const s = make();
    s.start();
    await clock.move(0);
    return s;
  }

  it('2 minutes, then 59 minutes with no answer: still let in, nothing stopped, the bar saying how long; an hour after the last answer, the stop', async () => {
    const s = await startedIn();
    list.check_ = 'silent';
    await pass(2 * MINUTE);
    expect(accessState().phase).toBe('warning');
    expect(isLetIn()).toBe(true);
    expect(offlineLine(s.view().stopsInMs ?? 0)).toBe(
      'Can’t reach the access list: Drashti keeps working for 58 minutes more.',
    );
    await pass(57 * MINUTE);
    expect(accessState().phase).toBe('warning');
    expect(isLetIn()).toBe(true);
    await pass(MINUTE - 1);
    expect(isLetIn()).toBe(true);
    await pass(1);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
  });

  it('the list answering again after a while without the internet: revoked stops it at once, let in takes the bar away', async () => {
    const s = await startedIn();
    list.check_ = 'silent';
    await pass(10 * MINUTE);
    expect(accessState().phase).toBe('warning');
    list.check_ = 'in';
    await pass(ACCESS_CHECK_EVERY_MS);
    expect(s.view()).toMatchObject({ phase: 'in', stopsInMs: null });
    list.check_ = 'silent';
    await pass(30 * MINUTE);
    list.check_ = 'revoked';
    await pass(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked' });
  });

  it('a length that ends without the internet stops it at its end, by the last answer’s own time', async () => {
    list.endsAt = list.listNow() + 5 * MINUTE;
    await startedIn();
    list.check_ = 'silent';
    await pass(5 * MINUTE - SECOND);
    expect(accessState().phase).toBe('warning');
    await pass(2 * SECOND);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'expired' });
  });

  it('started again with no internet within the hour of an answer that let it in: it opens for the rest of the hour; after the hour it does not', async () => {
    await startedIn();
    list.check_ = 'silent';
    await pass(10 * MINUTE);
    let s = await restart();
    // Open at once (Session 55), its first check missed: no bar until three in a row are.
    expect(accessState()).toMatchObject({ phase: 'in', reason: null });
    expect(isLetIn()).toBe(true);
    await pass((BAR_AFTER_MISSES - 1) * ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('warning');
    expect(s.view().stopsInMs).toBe(50 * MINUTE - (BAR_AFTER_MISSES - 1) * ACCESS_CHECK_EVERY_MS);
    await pass(50 * MINUTE - (BAR_AFTER_MISSES - 1) * ACCESS_CHECK_EVERY_MS - 1);
    expect(isLetIn()).toBe(true);
    await pass(1);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
    s = await restart();
    expect(s.view()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    // The list answering again (let in): it opens, as ever.
    list.check_ = 'in';
    await pass(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
  });

  it('a computer clock set back never opens it again without the internet: the time it ran without an answer is kept', async () => {
    await startedIn();
    list.check_ = 'silent';
    await pass(60 * MINUTE);
    expect(accessState().phase).toBe('stopped');
    clock.wall -= 3 * 60 * MINUTE;
    await restart();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    // Quit 20 minutes after an answer, then started an hour later with the clock set back to the quit: it may use
    // only what is left of the hour by the time it ran, never more.
    list.check_ = 'in';
    await pass(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
    list.check_ = 'silent';
    await pass(20 * MINUTE);
    service?.dispose();
    await pass(60 * MINUTE);
    clock.wall -= 60 * MINUTE;
    const s = await restart();
    expect(s.view().phase).toBe('in');
    await pass((BAR_AFTER_MISSES - 1) * ACCESS_CHECK_EVERY_MS);
    expect(s.view().phase).toBe('warning');
    expect(s.view().stopsInMs).toBeLessThanOrEqual(
      40 * MINUTE - (BAR_AFTER_MISSES - 1) * ACCESS_CHECK_EVERY_MS,
    );
  });

  it('never opens without an answer after one that said revoked, rejected or its length ended, nor once its length has ended meanwhile', async () => {
    keep();
    for (const status of ['revoked', 'rejected'] as const) {
      list.check_ = 'in';
      await restart();
      expect(accessState().phase, status).toBe('in');
      list.check_ = status;
      await pass(ACCESS_CHECK_EVERY_MS);
      expect(accessState().phase, status).toBe('stopped');
      list.check_ = 'silent';
      await restart();
      expect(accessState(), status).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    }
    // Its length ended (the list said so): never opened without the internet.
    list.check_ = 'in';
    list.endsAt = list.listNow() + MINUTE;
    await restart();
    expect(accessState().phase).toBe('in');
    await pass(MINUTE + 2 * SECOND);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'expired' });
    list.check_ = 'silent';
    await restart();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    // Let in for 30 minutes, then quit; started 40 minutes later with no internet: its length has ended meanwhile.
    list.check_ = 'in';
    list.endsAt = list.listNow() + 30 * MINUTE;
    await restart();
    expect(accessState().phase).toBe('in');
    service?.dispose();
    await pass(40 * MINUTE);
    list.check_ = 'silent';
    await restart();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
  });
});

describe('a start within the hour of an answer that let it in (Session 55, the owner’s decision of 29 Oct 2026)', () => {
  const MINUTE = 60_000;

  it('opens at once, before the list answers, and asks it in the background', async () => {
    await startedIn();
    await passBoth(10 * MINUTE);
    list.hold = { release: () => undefined };
    const checks = list.checks;
    const s = startAgain();
    // Let in at once: no "Checking this computer’s access…", no lock window.
    expect(accessState()).toMatchObject({ phase: 'in', gmail: PERSON, reason: null, stopsAt: null });
    expect(isLetIn()).toBe(true);
    await clock.move(0);
    // Asked at once, in the background, while Drashti is open.
    expect(list.checks).toBe(checks + 1);
    expect(isLetIn()).toBe(true);
    list.hold.release();
    list.hold = null;
    await clock.move(0);
    expect(s.view()).toMatchObject({ phase: 'in', stopsInMs: null });
    // The checks go on every 15 s from that one.
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(checks + 2);
    expect(logs.join('\n')).toContain('Drashti opens at once');
  });

  for (const status of ['revoked', 'rejected', 'unknown', 'expired'] as const)
    it(`a list that answers ${status} at that start stops it at that answer`, async () => {
      await startedIn();
      await passBoth(MINUTE);
      if (status === 'expired') list.endsAt = list.listNow() - SECOND;
      else list.check_ = status;
      startAgain();
      expect(accessState().phase).toBe('in');
      await clock.move(0);
      expect(accessState()).toMatchObject({ phase: 'stopped', reason: status });
      expect(isLetIn()).toBe(false);
    });

  it('an answer older than an hour, or none, or one that did not let it in: it waits for the list, as before', async () => {
    await startedIn();
    service?.dispose();
    await passBoth(ACCESS_STOP_AFTER_MS);
    startAgain();
    expect(accessState().phase).toBe('checking');
    await clock.move(0);
    expect(accessState().phase).toBe('in');
    // Revoked at the last answer: not opened before the list answers again.
    list.check_ = 'revoked';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('stopped');
    list.check_ = 'in';
    startAgain();
    expect(accessState().phase).toBe('checking');
  });

  it('its length ended by the last answer’s own time: it waits for the list, as before', async () => {
    list.endsAt = list.listNow() + 5 * MINUTE;
    await startedIn();
    service?.dispose();
    await passBoth(6 * MINUTE);
    startAgain();
    expect(accessState().phase).toBe('checking');
  });

  it('a check that never answers at that start still stops it at the end of the hour from the last answer', async () => {
    await startedIn();
    service?.dispose();
    await passBoth(50 * MINUTE);
    list.hold = { release: () => undefined };
    startAgain();
    expect(isLetIn()).toBe(true);
    await clock.move(10 * MINUTE - 1);
    expect(isLetIn()).toBe(true);
    await clock.move(1);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
  });
});

describe('the bar: only after about 2 minutes with no answer, several checks in a row (Session 55)', () => {
  it('needs three checks in a row with no answer, however long since the last answer', async () => {
    expect(BAR_AFTER_MISSES).toBe(3);
    expect(BAR_AFTER_MS).toBe(2 * 60_000);
    await startedIn();
    service?.dispose();
    await passBoth(20 * 60_000);
    list.check_ = 'silent';
    const s = startAgain();
    await clock.move(0);
    // Twenty minutes since the last answer, but only one check of this run missed: nothing said.
    expect(s.view()).toMatchObject({ phase: 'in', stopsInMs: null });
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(s.view().phase).toBe('in');
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(s.view().phase).toBe('warning');
    expect(s.view().stopsInMs).toBe(40 * 60_000 - 2 * ACCESS_CHECK_EVERY_MS);
  });

  it('a check now and then that misses, on a network that works, never shows the bar', async () => {
    const s = await startedIn();
    const seen = new Set<string>();
    s.onView((v) => seen.add(v.phase));
    for (let i = 0; i < 40; i++) {
      // Every other check missed (a slow hotspot): never 2 minutes without an answer.
      list.check_ = i % 2 === 0 ? 'silent' : 'in';
      await clock.move(ACCESS_CHECK_EVERY_MS);
    }
    expect(seen.has('warning')).toBe(false);
    expect(accessState().phase).toBe('in');
  });
});

describe('the network coming back (Session 55)', () => {
  /** Let in, then 2 minutes with no answer: the bar up, the last check just missed. */
  async function withTheBar(): Promise<AccessService> {
    const s = await startedIn();
    list.check_ = 'silent';
    await clock.move(BAR_AFTER_MS);
    expect(accessState().phase).toBe('warning');
    return s;
  }

  it('asks the list at once, not at the next 15 s check, and the bar goes with its answer', async () => {
    const s = await withTheBar();
    const checks = list.checks;
    // 2 s after the last check: the next is never closer than 5 s after it.
    await clock.move(2_000);
    list.check_ = 'in';
    s.networkBack('the computer is online again');
    await clock.move(0);
    expect(list.checks).toBe(checks);
    await clock.move(EARLY_GAP_MS - 2_000);
    expect(list.checks).toBe(checks + 1);
    expect(accessState()).toMatchObject({ phase: 'in', stopsAt: null });
    expect(logs.join('\n')).toContain('the computer is online again');
    // The checks go on every 15 s from that one.
    await clock.move(ACCESS_CHECK_EVERY_MS - 1);
    expect(list.checks).toBe(checks + 1);
    await clock.move(1);
    expect(list.checks).toBe(checks + 2);
  });

  it('5 s or more after the last check, asks at that very moment', async () => {
    const s = await withTheBar();
    await clock.move(EARLY_GAP_MS);
    const checks = list.checks;
    list.check_ = 'in';
    s.networkBack('the computer is on another network');
    await clock.move(0);
    expect(list.checks).toBe(checks + 1);
    expect(accessState().phase).toBe('in');
  });

  it('gives up a check still waiting on the old network, and asks again at once', async () => {
    const s = await withTheBar();
    // The next check waits and waits (a network with no internet behind it).
    list.hold = { release: () => undefined };
    await clock.move(ACCESS_CHECK_EVERY_MS + 10_000);
    const checks = list.checks;
    // The computer joins a hotspot: the waiting check is given up, and the list asked again at once.
    list.hold = null;
    list.check_ = 'in';
    s.networkBack('the computer is on another network');
    await clock.move(0);
    expect(list.aborted).toBe(1);
    expect(list.checks).toBe(checks + 1);
    expect(accessState()).toMatchObject({ phase: 'in', stopsAt: null });
  });

  it('a check begun a moment before has until 5 s to answer, then it is given up and the list asked again', async () => {
    const s = await withTheBar();
    list.hold = { release: () => undefined };
    await clock.move(ACCESS_CHECK_EVERY_MS + 1_000);
    const checks = list.checks;
    list.hold = null;
    list.check_ = 'in';
    s.networkBack('the computer is online again');
    await clock.move(0);
    expect(list.aborted).toBe(0);
    await clock.move(EARLY_GAP_MS - 1_000);
    expect(list.aborted).toBe(1);
    expect(list.checks).toBe(checks + 1);
    expect(accessState().phase).toBe('in');
  });

  it('a check begun since the network came back (checks closer than 5 s, a test switch) gets its own 5 s before it is given up', async () => {
    keep();
    const s = make({ checkEveryMs: 2_000 });
    s.start();
    await clock.move(0);
    list.check_ = 'silent';
    await clock.move(2_000);
    // A check missed; the network back: the list to be asked 5 s after that check began.
    s.networkBack('the computer is online again');
    // Meanwhile the next check begins (2 s after the last) and waits.
    list.hold = { release: () => undefined };
    await clock.move(2_000);
    const checks = list.checks;
    await clock.move(3_000);
    // 5 s after the missed check, but this one began only 3 s ago: not given up yet.
    expect(list.aborted).toBe(0);
    list.hold = null;
    list.check_ = 'in';
    await clock.move(2_000);
    // Its own 5 s up: given up, and the list asked again at once.
    expect(list.aborted).toBe(1);
    expect(list.checks).toBe(checks + 1);
    expect(accessState().phase).toBe('in');
  });

  it('asks nothing more while the list answers, and on a network coming and going many times a second never asks more than once in 5 s', async () => {
    const s = await startedIn();
    let checks = list.checks;
    for (let i = 0; i < 20; i++) {
      s.networkBack('the computer is on another network');
      await clock.move(250);
    }
    expect(list.checks).toBe(checks);
    list.check_ = 'silent';
    await clock.move(ACCESS_CHECK_EVERY_MS - 5_000);
    // A check missed: from now on the network coming back asks, but never twice in 5 s.
    checks = list.checks;
    for (let i = 0; i < 80; i++) {
      s.networkBack(i % 2 === 0 ? 'the computer is online again' : 'the computer is on another network');
      await clock.move(250);
    }
    expect(list.checks - checks).toBe(20_000 / EARLY_GAP_MS);
    // Said in the log at most once a minute, not at every flap.
    const said = logs.filter((l) => l.includes('the network came back')).length;
    expect(said).toBeLessThanOrEqual(1);
  });

  it('on the lock screen with no answer, asks again at once rather than at its next try in 15 s', async () => {
    keep();
    list.check_ = 'silent';
    const s = make();
    s.start();
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    await clock.move(EARLY_GAP_MS + 1_000);
    list.check_ = 'in';
    s.networkBack('the computer is online again');
    await clock.move(0);
    expect(accessState().phase).toBe('in');
    expect(list.checks).toBe(2);
  });

  it('never asks once Drashti has stopped, nor on a computer never let in', async () => {
    const s = await startedIn();
    list.check_ = 'revoked';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('stopped');
    const checks = list.checks;
    s.networkBack('the computer is online again');
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(checks);
    service?.dispose();
    rmSync(join(dir, ACCESS_FILE));
    setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null });
    const fresh = make();
    fresh.start();
    fresh.networkBack('the computer is online again');
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(list.checks).toBe(checks);
    expect(clock.waiting).toBe(0);
  });
});

describe('the lock screen', () => {
  it('Request Access: a Gmail that is not one is said on its field; one that is asks, and what came of it is asked every 30 s', async () => {
    const asked = new MemoryAsked();
    const s = make({ asked });
    s.start();
    const bad = await s.requestAccess('not an address', '');
    expect(bad.message).toMatchObject({ field: 'gmail' });
    expect(list.calls).toEqual([]);
    const v = await s.requestAccess(` ${PERSON} `, 'Placeholder Person');
    expect(v.request).toEqual({ gmail: PERSON, status: 'requested', tokenWaiting: false });
    expect(v.message?.tone).toBe('success');
    expect(asked.gmail).toBe(PERSON);
    await clock.move(ASK_EVERY_MS);
    expect(list.calls).toEqual(['request', 'status']);
    list.statusAnswer = 'rejected';
    await clock.move(ASK_EVERY_MS);
    const told = s.view();
    expect(told.request?.status).toBe('rejected');
    expect(told.message).toMatchObject({ tone: 'danger', text: 'Your request for access was not approved.' });
    // Told plainly, and nothing more happens.
    expect(asked.gmail).toBeNull();
    await clock.move(ASK_EVERY_MS * 4);
    expect(list.calls).toEqual(['request', 'status', 'status']);
    expect(accessState().phase).toBe('locked');
  });

  it('Request Access for a Gmail already approved says to use the token; with no internet, says so', async () => {
    const s = make();
    s.start();
    list.requestAnswer = 'already-approved';
    expect((await s.requestAccess(PERSON, '')).message?.text).toContain('I Have a Token');
    list.requestAnswer = 'silent';
    expect((await s.requestAccess(PERSON, '')).message?.text).toContain('No internet');
  });

  it('a request made before this start: what came of it is asked once more', async () => {
    const asked = new MemoryAsked();
    asked.gmail = PERSON;
    list.statusAnswer = 'approved';
    const s = make({ asked });
    s.start();
    await clock.move(0);
    expect(s.view().request).toEqual({ gmail: PERSON, status: 'approved', tokenWaiting: true });
    expect(s.view().message?.text).toContain('I Have a Token');
  });

  it('I Have a Token: a token that is not one is said on its field; a wrong one too; the right one lets this computer in', async () => {
    const s = make();
    s.start();
    expect((await s.redeemToken(PERSON, 'ABCD')).message).toMatchObject({ field: 'token' });
    expect(list.calls).toEqual([]);
    list.redeemAnswer = 'bad-token';
    expect((await s.redeemToken(PERSON, TOKEN)).message).toMatchObject({ field: 'token' });
    expect(accessState().phase).toBe('locked');
    list.redeemAnswer = 'ok';
    list.owner = true;
    const v = await s.redeemToken(PERSON, TOKEN.toLowerCase().replaceAll('-', ' '));
    expect(v).toMatchObject({ phase: 'in', owner: true, gmail: PERSON });
    expect(list.calls).toEqual(['redeem', 'redeem', 'check']);
    // Kept in the data folder, made on this computer.
    const kept = store().read();
    expect(kept.status === 'ok' && kept.value.computerId).toBe(HERE);
    expect(kept.status === 'ok' && kept.value.grantId).toBe(GRANT.grantId);
  });

  it('never writes a Gmail, a token or a secret into the log', async () => {
    const s = make();
    s.start();
    await s.requestAccess(PERSON, 'Placeholder Person');
    await s.redeemToken(PERSON, TOKEN);
    list.check_ = 'revoked';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(3);
    for (const secret of [
      PERSON,
      'placeholder.user',
      TOKEN,
      TOKEN.replaceAll('-', ''),
      GRANT.secret,
      GRANT.grantId,
    ])
      expect(all).not.toContain(secret);
  });
});

describe('the last request, kept in the data folder', () => {
  it('is written whole, read back, and forgotten', () => {
    const asked = new AskedFile(dir);
    expect(asked.read()).toBeNull();
    asked.write(PERSON);
    expect(new AskedFile(dir).read()).toBe(PERSON);
    asked.write(null);
    expect(asked.read()).toBeNull();
  });
});

describe('against the stand-in list (the list’s own rules)', () => {
  let standIn: AccessStandIn | null = null;
  afterEach(async () => {
    await standIn?.close();
    standIn = null;
  });

  it('asks, is approved by the link, comes in with the token once, and stops at the check after a revoke', async () => {
    const s0 = (standIn = await accessStandIn());
    const computer = placeholderComputer('service-mac');
    const client = new AccessClient({
      url: s0.url,
      publicKey: s0.publicKey,
      computer,
      transport: nodeTransport,
      local: true,
    });
    const asked = new MemoryAsked();
    service = new AccessService({
      calls: client,
      kept: store(),
      asked,
      computer: { ok: true, id: computer.id },
      selfTest: false,
      version: '1.0.0-alpha.13',
      monotonic: () => clock.t,
      now: () => clock.wall,
      setTimer: clock.setTimer,
      log: () => undefined,
    });
    const s = service;
    s.start();
    expect(accessState().phase).toBe('locked');
    await s.requestAccess(PERSON, 'Placeholder Person');
    s0.press(s0.list.linksFor(PERSON)?.approve ?? '');
    const token = s0.list.tokenFor(PERSON) ?? '';
    expect(token).not.toBe('');
    await s.redeemToken(PERSON, token);
    expect(accessState()).toMatchObject({ phase: 'in', gmail: PERSON, owner: false });
    // The token works once.
    expect(s0.calls).toEqual(['request', 'redeem', 'check']);
    // The owner revokes the Gmail (in the Sheet itself, as the owner may): the next check stops everything.
    s0.list.sheet.type('Access List', 'Gmail', PERSON, 'Status', 'revoked');
    s0.list.move(ACCESS_CHECK_EVERY_MS);
    await clock.move(ACCESS_CHECK_EVERY_MS);
    await expect.poll(() => accessState().phase).toBe('stopped');
    expect(accessState().reason).toBe('revoked');
  });

  it('a length of 1 day chosen on the Approve page: the bar at once, from the list’s own clock, and the stop once the list’s clock passes the end, this computer’s clock a year back', async () => {
    const s0 = (standIn = await accessStandIn());
    const computer = placeholderComputer('service-length-mac');
    const client = new AccessClient({
      url: s0.url,
      publicKey: s0.publicKey,
      computer,
      transport: nodeTransport,
      local: true,
    });
    service = new AccessService({
      calls: client,
      kept: store(),
      asked: new MemoryAsked(),
      computer: { ok: true, id: computer.id },
      selfTest: false,
      version: '1.0.0-alpha.13',
      monotonic: () => clock.t,
      now: () => clock.wall - 365 * DAY,
      setTimer: clock.setTimer,
      log: () => undefined,
    });
    const s = service;
    s.start();
    await s.requestAccess(PERSON, 'Placeholder Person');
    s0.press(s0.list.linksFor(PERSON)?.approve ?? '', '1');
    await s.redeemToken(PERSON, s0.list.tokenFor(PERSON) ?? '');
    expect(accessState().phase).toBe('in');
    expect(s.view()).toMatchObject({ endsAt: s0.list.t + DAY, endsInMs: DAY });
    expect(endsBarShown(s.view().endsInMs)).toBe(true);
    s0.list.move(DAY - ACCESS_CHECK_EVERY_MS);
    await clock.move(ACCESS_CHECK_EVERY_MS);
    // Its answer heard (15 s left by the list's clock), and the next check set for the end.
    await expect.poll(() => s.view().endsInMs).toBe(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
    s0.list.move(ACCESS_CHECK_EVERY_MS);
    await clock.move(ACCESS_CHECK_EVERY_MS);
    await expect.poll(() => accessState().phase).toBe('stopped');
    expect(accessState().reason).toBe('expired');
  });
});

describe('a call that throws (Session 54, E review: never fail open)', () => {
  it('while open, is no answer: the bar after 2 minutes, then the stop', async () => {
    await startedIn();
    list.check_ = 'throw';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
    await clock.move(BAR_AFTER_MS - ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('warning');
    await clock.move(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
  });

  it('at start, is no answer: Drashti does not open, and Try Again is offered', async () => {
    keep();
    list.check_ = 'throw';
    const s = make();
    s.start();
    await clock.move(0);
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
    expect(s.view()).toMatchObject({ canRetry: true, busy: null });
    list.check_ = 'in';
    await s.retry();
    expect(accessState().phase).toBe('in');
  });

  it('the lock screen’s own calls that throw leave it usable, saying no internet', async () => {
    const s = make({
      calls: {
        request: () => Promise.reject(new Error('placeholder: thrown')),
        status: list.status.bind(list),
        redeem: () => Promise.reject(new Error('placeholder: thrown')),
        check: list.check.bind(list),
      },
    });
    s.start();
    const asked = await s.requestAccess(PERSON, '');
    expect(asked).toMatchObject({ busy: null, phase: 'locked' });
    expect(asked.message?.text).toContain('No internet');
    const used = await s.redeemToken(PERSON, TOKEN);
    expect(used).toMatchObject({ busy: null, phase: 'locked' });
  });

  it('the time a signed call carries: the kept one, or this computer’s when the data folder cannot be written', () => {
    const said: string[] = [];
    let fail = false;
    const at = keptAt(
      {
        nextAt: (now) => {
          if (fail) throw new Error('placeholder: EPERM');
          return now + 1;
        },
      },
      () => 5000,
      (line) => said.push(line),
    );
    expect(at()).toBe(5001);
    fail = true;
    expect(at()).toBe(5000);
    expect(at()).toBe(5000);
    // Said once, not at every check.
    expect(said.length).toBe(1);
    expect(said[0]).not.toContain('placeholder.user');
  });
});

describe('the performance check’s own check (Session 54, E review)', () => {
  it('lets in as any start does, and counts nothing of its own run into this computer’s totals', async () => {
    keep(HERE, { minutes: 10, shows: 1, streams: 0, recordings: 0, imports: 0 });
    const s = make({ counts: false });
    s.start();
    await clock.move(0);
    expect(accessState().phase).toBe('in');
    s.count('shows', 5);
    await clock.move(5 * 60_000);
    const kept = JSON.parse(readFileSync(join(dir, ACCESS_FILE), 'utf8')) as { activity: AccessActivity };
    expect(kept.activity).toEqual({ minutes: 10, shows: 1, streams: 0, recordings: 0, imports: 0 });
    expect(list.activities.at(-1)).toEqual({ minutes: 10, shows: 1, streams: 0, recordings: 0, imports: 0 });
  });

  it('asks with the access kept in this computer’s own data folder; a test’s folder only unpackaged', () => {
    const home = '/Users/placeholder/Library/Application Support/Drashti';
    const test = '/tmp/placeholder-let-in';
    expect(performanceAccessFolder({ packaged: true, home, testFolder: undefined })).toBe(home);
    expect(performanceAccessFolder({ packaged: true, home, testFolder: test })).toBe(home);
    expect(performanceAccessFolder({ packaged: false, home, testFolder: undefined })).toBe(home);
    expect(performanceAccessFolder({ packaged: false, home, testFolder: test })).toBe(test);
  });
});

describe('a computer that sleeps (Session 54, E review: Windows counts the time asleep)', () => {
  const HOUR = 60 * 60_000;

  it('woken with no internet yet: never a stop, nor a bar, for the time it slept; the bar after 2 minutes awake with no answer', async () => {
    const s = await startedIn();
    clock.sleep(HOUR);
    list.check_ = 'silent';
    await clock.move(0);
    // The time asleep is not counted: one check missed, 15 s after the last answer.
    expect(accessState()).toMatchObject({ phase: 'in', stopsAt: null });
    expect(isLetIn()).toBe(true);
    await clock.move(BAR_AFTER_MS - ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('warning');
    expect(s.view().stopsInMs).toBe(ACCESS_STOP_AFTER_MS - BAR_AFTER_MS);
    // And the list answering once the network is back: let in.
    list.check_ = 'in';
    await clock.move(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('in');
  });

  it('asleep during the countdown: woken, the countdown goes on about where it was, then the stop', async () => {
    const s = await startedIn();
    list.check_ = 'silent';
    await clock.move(BAR_AFTER_MS);
    expect(accessState().phase).toBe('warning');
    const left = s.view().stopsInMs ?? 0;
    clock.sleep(HOUR);
    await clock.move(0);
    expect(accessState().phase).toBe('warning');
    // When it fell asleep is not known: at most one check's time is counted as awake.
    const after = s.view().stopsInMs ?? 0;
    expect(after).toBeLessThanOrEqual(left);
    expect(after).toBeGreaterThanOrEqual(left - ACCESS_CHECK_EVERY_MS);
    await clock.move(after);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-answer' });
  });

  it('never stretches the hour when no timer ran late', async () => {
    await startedIn();
    list.check_ = 'silent';
    await clock.move(ACCESS_STOP_AFTER_MS);
    expect(accessState().phase).toBe('stopped');
  });
});
