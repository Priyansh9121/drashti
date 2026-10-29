import { sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { core, linkParams, PEOPLE, placeholderComputer, TestList } from '../../../tests/access-core';
import { ACCESS_CHECK_EVERY_MS } from '../../shared/access-protocol';
import { AccessClient, type AccessReply, type AccessTransport } from './client';
import { accessState, setAccessState } from './gate';
import { AccessService, keptAt } from './service';
import { AccessStore } from './store';

/*
 * The attacker's review of Session 55's Parts 3 and 19 together (30 Oct 2026): its proofs, kept as tests that each
 * attack now fails. The real client (the list's signatures checked), the real store (an access.json in a folder of its
 * own) and the real service, against the list's own rules (access-list/core.js, through tests/access-core.ts) behind
 * an in-process "Google": no network at all, placeholder Gmails only. Time is three clocks: the list's, this
 * computer's own, and the time Drashti runs (the monotonic clock its timers run on, which a Mac's sleep stops).
 */

const PERSON = 'placeholder.user@example.com';
const SECOND_PERSON = 'placeholder.second@example.com';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
/** An address in the shape of Google's, never reached: the transport below answers in this process. */
const GOOGLE = 'https://script.google.com/macros/s/placeholder-review-deployment/exec';
const START_STATE = {
  phase: 'checking',
  gmail: null,
  owner: false,
  reason: null,
  stopsAt: null,
  mode: 'pro',
} as const;

/** The main process's monotonic clock (its timers run on it) and this computer's own clock, which the test moves. */
class TestClock {
  t = 50_000;
  wall = Date.UTC(2026, 10, 1, 10, 0, 0);
  private timers: { at: number; run: () => void }[] = [];
  setTimer = (ms: number, run: () => void): (() => void) => {
    const timer = { at: this.t + Math.max(0, ms), run };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((x) => x !== timer);
    };
  };
  /** The monotonic clock moves `ms`, each timer due on the way run (this computer's clock is moved by the caller). */
  async move(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await settle();
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.run();
    }
    this.t = end;
    await settle();
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

let clock = new TestClock();
let list = new TestList();

/** Time passes for everyone: the list's clock, this computer's clock and the time Drashti runs. */
async function passBoth(ms: number): Promise<void> {
  list.move(ms);
  clock.wall += ms;
  await clock.move(ms);
}

/** Time passes with Drashti not running, or with a Mac asleep: the list's clock and this computer's clock only. */
function passOff(ms: number): void {
  list.move(ms);
  clock.wall += ms;
}

const reply = (status: number, location: string | null, text = ''): AccessReply => ({
  status,
  location,
  text: () => Promise.resolve(text),
  cancel: () => undefined,
});

/** "Google": the list's rules behind its HTTPS address, with Apps Script's one redirect, in this process. */
class Google {
  offline = false;
  /** How long each answer takes (on the monotonic clock); given up, it ends at once. */
  delayMs = 0;
  posts = 0;
  private answer = '';
  constructor(private readonly handle: (text: string) => { payload: string; sig: string }) {}
  readonly transport: AccessTransport = async ({ method, body, signal }) => {
    if (this.offline) throw new Error('net::ERR_INTERNET_DISCONNECTED');
    if (method === 'POST') {
      this.posts += 1;
      if (this.delayMs > 0) await takes(this.delayMs, signal);
      this.answer = JSON.stringify(this.handle(body ?? ''));
      return reply(302, 'https://script.googleusercontent.com/macros/echo?user_content_key=placeholder');
    }
    return reply(200, null, this.answer);
  };
}

/** An answer on its way for `ms` of the monotonic clock, or given up. */
function takes(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cancel = clock.setTimer(ms, resolve);
    signal.addEventListener(
      'abort',
      () => {
        cancel();
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

class MemoryAsked {
  gmail: string | null = null;
  read = (): string | null => this.gmail;
  write = (gmail: string | null): void => {
    this.gmail = gmail;
  };
}

let dir = '';
let google = new Google((t) => list.handle(t));
let running: AccessService[] = [];
const COMPUTER = placeholderComputer('placeholder-review-mac');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-review-attacks-'));
  clock = new TestClock();
  // The list's clock and this computer's a few minutes apart, as two clocks are.
  list = new TestList({ start: clock.wall - 3 * MINUTE });
  google = new Google((t) => list.handle(t));
  running = [];
  setAccessState({ ...START_STATE });
});

afterEach(() => {
  for (const s of running) s.dispose();
  setAccessState({ ...START_STATE });
  rmSync(dir, { recursive: true, force: true });
});

const file = (): string => join(dir, 'access.json');

/** One run of Drashti on this computer. */
function start(o: { computer?: typeof COMPUTER; checkEveryMs?: number } = {}): AccessService {
  const computer = o.computer ?? COMPUTER;
  const store = new AccessStore(dir);
  const client = new AccessClient({
    url: GOOGLE,
    publicKey: list.keys.publicKey,
    computer,
    transport: google.transport,
    at: keptAt(
      store,
      () => clock.wall,
      () => undefined,
    ),
  });
  const service = new AccessService({
    calls: client,
    kept: store,
    asked: new MemoryAsked(),
    computer: { ok: true, id: computer.id },
    selfTest: false,
    version: '1.0.0-alpha.14',
    monotonic: () => clock.t,
    now: () => clock.wall,
    setTimer: clock.setTimer,
    log: () => undefined,
    ...(o.checkEveryMs ? { checkEveryMs: o.checkEveryMs } : {}),
  });
  running.push(service);
  service.start();
  return service;
}

function quit(s: AccessService): void {
  s.dispose();
  running = running.filter((x) => x !== s);
  setAccessState({ ...START_STATE });
}

/** Asked, approved on the Approve page as the owner presses it, the token typed: let in. */
async function letIn(
  gmail: string,
  o: { mode?: 'pro' | 'simple'; length?: string; checkEveryMs?: number } = {},
): Promise<AccessService> {
  const s = start(o.checkEveryMs ? { checkEveryMs: o.checkEveryMs } : {});
  await clock.move(0);
  expect(accessState().phase).toBe('locked');
  await s.requestAccess(gmail, 'Placeholder Person');
  const page = core.answerLink(list.env, {
    ...linkParams(list.linksFor(gmail)?.approve ?? ''),
    length: o.length ?? 'unlimited',
    mode: o.mode ?? 'simple',
  });
  expect(page.kind).toBe('done');
  await s.redeemToken(gmail, list.tokenFor(gmail) ?? '');
  expect(accessState().phase).toBe('in');
  return s;
}

/** Started, and the list asked (offline, it answers nothing): what the start comes to. */
async function startOffline(): Promise<AccessService> {
  const s = start();
  await clock.move(0);
  return s;
}

const revoke = (gmail = PERSON): void => list.sheet.type(PEOPLE, 'Gmail', gmail, 'Status', 'revoked');

describe('finding 1: the 15 days count from the list’s own time, so a clock set forward for one check gains nothing', () => {
  it('the clock set forward ten years for one check, then put right: 60 days later, revoked meanwhile, an offline start opens nothing; the lock says to ask again', async () => {
    const s = await letIn(PERSON, { mode: 'pro' });
    clock.wall += 10 * YEAR;
    await passBoth(ACCESS_CHECK_EVERY_MS);
    clock.wall -= 10 * YEAR;
    google.offline = true;
    await passBoth(ACCESS_CHECK_EVERY_MS);
    quit(s);
    revoke();
    passOff(60 * DAY);
    await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-contact' });
  });

  it('…and with Drashti kept open, a Mac asleep 16 days after such a check counts its sleep: it stops (no-contact)', async () => {
    await letIn(PERSON, { mode: 'pro' });
    clock.wall += 10 * YEAR;
    await passBoth(ACCESS_CHECK_EVERY_MS);
    clock.wall -= 10 * YEAR;
    google.offline = true;
    await passBoth(ACCESS_CHECK_EVERY_MS);
    revoke();
    // Asleep: the list's clock and this computer's go on; the monotonic clock does not (macOS).
    passOff(16 * DAY);
    await passBoth(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'no-contact' });
  });

  it('a computer whose clock stays a month ahead (set wrong, never put right) is not stopped for it while the list answers', async () => {
    await letIn(PERSON, { mode: 'pro' });
    clock.wall += 30 * DAY;
    for (let i = 0; i < 8; i++) await passBoth(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'in', mode: 'pro' });
  });

  it('control: the clock right all along, 60 days later: locked (no-contact)', async () => {
    const s = await letIn(PERSON, { mode: 'pro' });
    google.offline = true;
    await passBoth(ACCESS_CHECK_EVERY_MS);
    quit(s);
    passOff(60 * DAY);
    await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-contact' });
  });
});

describe('finding 3: an answer kept here is believed only for this grant', () => {
  it('another grant’s signed Pro answer on this computer, put into a Simple grant’s access.json, opens nothing at once', async () => {
    const first = await letIn(PERSON, { mode: 'pro' });
    const proAnswer = (JSON.parse(readFileSync(file(), 'utf8')) as { answer: unknown }).answer;
    revoke();
    await passBoth(ACCESS_CHECK_EVERY_MS);
    expect(accessState().phase).toBe('stopped');
    quit(first);
    // A second Gmail, given Simple, lets the same computer in: a new grant, a new access.json.
    const second = start();
    await clock.move(0);
    await second.requestAccess(SECOND_PERSON, 'Placeholder Second');
    const approved = core.answerLink(list.env, {
      ...linkParams(list.linksFor(SECOND_PERSON)?.approve ?? ''),
      mode: 'simple',
    });
    expect(approved.kind).toBe('done');
    await second.redeemToken(SECOND_PERSON, list.tokenFor(SECOND_PERSON) ?? '');
    expect(accessState()).toMatchObject({ phase: 'in', mode: 'simple', gmail: SECOND_PERSON });
    quit(second);
    const kept = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    writeFileSync(file(), JSON.stringify({ ...kept, answer: proAnswer }));
    google.offline = true;
    await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-answer' });
  });

  it('an older access.json of the same grant put back is believed only within the 15 days of its own answer, by the list’s clock', async () => {
    const s = await letIn(PERSON, { mode: 'pro' });
    const older = readFileSync(file(), 'utf8');
    revoke();
    await passBoth(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked' });
    quit(s);
    google.offline = true;
    passOff(16 * DAY);
    writeFileSync(file(), older);
    await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-contact' });
  });
});

describe('finding 4: a length’s end counts on the same two clocks as the 15 days', () => {
  it('a 1-day length: a Mac asleep 3 days with Drashti open stops at the first check after, its length ended', async () => {
    const s = await letIn(PERSON, { mode: 'pro', length: '1' });
    expect(s.view().endsInMs).toBeLessThanOrEqual(DAY);
    google.offline = true;
    await passBoth(HOUR);
    passOff(3 * DAY);
    await passBoth(ACCESS_CHECK_EVERY_MS);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'expired' });
  });

  it('a clock set back gains nothing: the day runs out on the time run', async () => {
    await letIn(PERSON, { mode: 'pro', length: '1', checkEveryMs: HOUR });
    google.offline = true;
    await passBoth(HOUR);
    clock.wall -= 10 * DAY;
    await passBoth(DAY);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'expired' });
  });
});

describe('finding 5: a list that echoes no `at` (as the one from before)', () => {
  it('counts the 15 days from the list’s signed time, never from the time access.json says it was heard', async () => {
    // The list's answers without the check's own time, signed again with its key.
    google = new Google((text) => {
      const answer = list.handle(text);
      const { at: _at, ...payload } = JSON.parse(answer.payload) as Record<string, unknown>;
      if (payload['op'] !== 'check') return answer;
      const again = JSON.stringify(payload);
      return {
        payload: again,
        sig: sign('sha256', Buffer.from(again, 'utf8'), list.keys.privateKey).toString('base64'),
      };
    });
    const s = await letIn(PERSON, { mode: 'pro' });
    quit(s);
    google.offline = true;
    passOff(20 * DAY);
    const before = await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-contact' });
    quit(before);
    const kept = JSON.parse(readFileSync(file(), 'utf8')) as { answer: { heardAt: number } };
    writeFileSync(
      file(),
      JSON.stringify({ ...kept, answer: { ...kept.answer, heardAt: clock.wall - MINUTE } }),
    );
    await startOffline();
    expect(accessState()).toMatchObject({ phase: 'locked', reason: 'no-contact' });
  });
});

describe('finding 6: the network coming back never keeps a slow list from being heard', () => {
  it('the network changing every 3 s and a list answering in 6 s: the revoke is heard all the same', async () => {
    const s = await letIn(PERSON, { mode: 'pro' });
    revoke();
    google.delayMs = 6_000;
    for (let i = 0; i < 40 && accessState().phase !== 'stopped'; i++) {
      s.networkBack('the computer is on another network');
      await passBoth(3_000);
    }
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked' });
  });

  it('…with checks missed before: the check after one given up runs to its end, so the revoke is heard', async () => {
    const s = await letIn(PERSON, { mode: 'pro' });
    google.offline = true;
    await passBoth(4 * ACCESS_CHECK_EVERY_MS);
    google.offline = false;
    revoke();
    google.delayMs = 6_000;
    for (let i = 0; i < 40 && accessState().phase !== 'stopped'; i++) {
      s.networkBack('the computer is on another network');
      await passBoth(3_000);
    }
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked' });
  });

  it('control: the same slow list with the network still: stopped (revoked)', async () => {
    await letIn(PERSON, { mode: 'pro' });
    revoke();
    google.delayMs = 6_000;
    await passBoth(MINUTE);
    expect(accessState()).toMatchObject({ phase: 'stopped', reason: 'revoked' });
  });
});
