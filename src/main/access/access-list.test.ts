import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLACEHOLDER_APPROVER, placeholderComputer } from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';
import {
  accessListCsv,
  ACCESS_LIST_REFRESH_MS,
  EDIT_NO_ANSWER_TEXT,
  NO_ANSWER_TEXT,
  ownerErrorText,
} from '../../shared/access-list';
import { ACCESS_ERROR_TEXT, type AccessPerson } from '../../shared/access-protocol';
import {
  AccessList,
  ownerCalls,
  type AccessListDeps,
  type OwnerCalls,
  type OwnerResult,
} from './access-list';
import { AccessClient, nodeTransport } from './client';

/*
 * View › Access List… (Session 54, E4), its main-process side: only while this computer is the owner's, let in,
 * does it ask the list or change anything; each edit goes to the list as the owner's signed call, then the list
 * is asked again; Revoke and Reject never reach the owner's own row; the window's list is asked again every few
 * seconds while it is open; and the CSV is made here from the list's own answer, of the rows the window shows.
 * First against owner calls made in the test, then through Drashti's real client (client.ts) and the stand-in
 * list on 127.0.0.1, which runs the list's own rules. Placeholder Gmails only.
 */

const OWNER = PLACEHOLDER_APPROVER;
const PERSON = 'placeholder.user@example.com';

const person = (o: Partial<AccessPerson> & { gmail: string }): AccessPerson => ({
  name: '',
  status: 'approved',
  owner: false,
  requestedAt: null,
  approvedAt: null,
  rejectedAt: null,
  revokedAt: null,
  lastSeen: null,
  version: '',
  minutes: 0,
  shows: 0,
  streams: 0,
  recordings: 0,
  imports: 0,
  note: '',
  computers: [],
  token: null,
  request: null,
  ...o,
});

const answer = <T>(value: T): Promise<OwnerResult<T>> => Promise.resolve({ ok: true, value });
const refused = (
  error: 'wrong-status' | 'server' | 'owner-row' | 'mail-limit',
): Promise<OwnerResult<never>> =>
  Promise.resolve({ ok: false, kind: 'refused', error, message: 'The list’s own words' });
const noAnswer: Promise<OwnerResult<never>> = Promise.resolve({
  ok: false,
  kind: 'no-answer',
  detail: 'No connection',
});

/** Owner calls made in the test: each call's op and target, and what the list holds. */
function fakeCalls(
  people: AccessPerson[] = [person({ gmail: OWNER, owner: true }), person({ gmail: PERSON })],
) {
  const made: string[] = [];
  const calls: OwnerCalls = {
    list: vi.fn(() => {
      made.push('list');
      return answer({ people: people.map((p) => ({ ...p })) });
    }),
    add: vi.fn((target: string, o: { name?: string; note?: string }) => {
      made.push(`add ${target} ${o.name ?? ''} ${o.note ?? ''}`.trimEnd());
      return answer({ mailed: true });
    }),
    approve: vi.fn((target: string) => {
      made.push(`approve ${target}`);
      return answer({ runsOut: new Date(2026, 9, 30, 12).getTime() });
    }),
    regrant: vi.fn((target: string) => {
      made.push(`regrant ${target}`);
      return answer({ runsOut: new Date(2026, 9, 30, 12).getTime() });
    }),
    reject: vi.fn((target: string) => {
      made.push(`reject ${target}`);
      return answer({ mailed: true });
    }),
    revoke: vi.fn((target: string) => {
      made.push(`revoke ${target}`);
      return answer({});
    }),
    note: vi.fn((target: string, note: string) => {
      made.push(`note ${target} ${note}`);
      return answer({});
    }),
  };
  return { calls, made, people };
}

interface Rig {
  list: AccessList;
  made: string[];
  calls: OwnerCalls;
  owner: { on: boolean };
  views: number;
  saved: { path: string; text: string }[];
  saveAs: { answer: string | null };
  logs: string[];
}

function rig(o: { calls?: ReturnType<typeof fakeCalls>; deps?: Partial<AccessListDeps> } = {}): Rig {
  const f = o.calls ?? fakeCalls();
  const r: Rig = {
    list: null as unknown as AccessList,
    made: f.made,
    calls: f.calls,
    owner: { on: true },
    views: 0,
    saved: [],
    saveAs: { answer: '/placeholder/folder/Drashti access list.csv' },
    logs: [],
  };
  r.list = new AccessList({
    calls: () => (r.owner.on ? f.calls : null),
    isOwner: () => r.owner.on,
    ownerGmail: () => (r.owner.on ? ' Owner.Placeholder@Example.com ' : null),
    changed: () => {
      r.views++;
    },
    now: () => Date.now(),
    saveAs: () => Promise.resolve(r.saveAs.answer),
    write: (path, text) => {
      r.saved.push({ path, text });
    },
    log: (line) => {
      r.logs.push(line);
    },
    ...o.deps,
  });
  return r;
}

describe('only the owner’s computer, let in', () => {
  it.each([
    ['with no owner’s calls to make', false],
    // Even were the owner's way in still kept on this computer: the gate says it is not let in as the owner.
    ['with the owner’s way in still kept', true],
  ])('asks the list, edits and saves nothing otherwise, and says so (%s)', async (_, kept) => {
    const f = fakeCalls();
    const r = rig({ calls: f, deps: kept ? { calls: () => f.calls } : {} });
    r.owner.on = false;
    const view = await r.list.refresh();
    expect(view.people).toBeNull();
    expect(view.problem).toBe(ACCESS_ERROR_TEXT['not-owner']);
    const results = [
      await r.list.add({ gmail: PERSON, name: '', note: '', approve: true }),
      await r.list.approve(PERSON),
      await r.list.reject(PERSON),
      await r.list.revoke(PERSON),
      await r.list.regrant(PERSON),
      await r.list.note(PERSON, 'Placeholder note'),
    ];
    for (const result of results)
      expect(result).toMatchObject({ ok: false, message: ACCESS_ERROR_TEXT['not-owner'] });
    expect(await r.list.exportCsv([PERSON])).toEqual({ ok: false, message: ACCESS_ERROR_TEXT['not-owner'] });
    expect(r.made).toEqual([]);
    expect(r.saved).toEqual([]);
  });

  it('forgets the list at once when the owner’s access ends, and stops asking', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.list.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.list.view().people).toHaveLength(2);
      r.owner.on = false;
      r.list.accessChanged();
      expect(r.list.view()).toEqual({ people: null, updatedAt: null, problem: null });
      const asked = r.made.length;
      await vi.advanceTimersByTimeAsync(ACCESS_LIST_REFRESH_MS * 4);
      expect(r.made.length).toBe(asked);
      // Let in as the owner again, it starts afresh: nothing from before is shown until the list answers.
      r.owner.on = true;
      expect(r.list.view()).toEqual({ people: null, updatedAt: null, problem: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the list, while the window is open', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 10, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is asked at once, then again every few seconds after each answer, until the window closes', async () => {
    const r = rig();
    r.list.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.made).toEqual(['list']);
    const first = r.list.view();
    expect(first.people?.map((p) => p.gmail)).toEqual([OWNER, PERSON]);
    expect(first.updatedAt).toBe(Date.now());
    expect(first.problem).toBeNull();
    expect(r.views).toBe(1);
    await vi.advanceTimersByTimeAsync(ACCESS_LIST_REFRESH_MS - 1);
    expect(r.made).toEqual(['list']);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.made).toEqual(['list', 'list']);
    expect(r.views).toBe(2);
    r.list.stop();
    await vi.advanceTimersByTimeAsync(ACCESS_LIST_REFRESH_MS * 4);
    expect(r.made).toEqual(['list', 'list']);
  });

  it('is asked once at a time: a refresh while one is under way waits for that one', async () => {
    let release: () => void = () => undefined;
    const f = fakeCalls();
    const slow = f.calls.list;
    f.calls.list = vi.fn(
      () =>
        new Promise<OwnerResult<{ people: AccessPerson[] }>>((resolve) => {
          release = () => {
            void slow().then(resolve);
          };
        }),
    );
    const r = rig({ calls: f });
    const one = r.list.refresh();
    const two = r.list.refresh();
    expect(f.calls.list).toHaveBeenCalledTimes(1);
    release();
    expect(await one).toEqual(await two);
  });

  it('keeps what it had, and says why, when the list cannot be reached or refuses', async () => {
    const f = fakeCalls();
    const r = rig({ calls: f });
    await r.list.refresh();
    const had = r.list.view();
    f.calls.list = () => noAnswer;
    vi.advanceTimersByTime(30_000);
    const lost = await r.list.refresh();
    expect(lost.people).toEqual(had.people);
    expect(lost.updatedAt).toBe(had.updatedAt);
    expect(lost.problem).toBe(NO_ANSWER_TEXT);
    f.calls.list = () => refused('server');
    expect((await r.list.refresh()).problem).toBe(ownerErrorText('server'));
    // Said in the log once while it lasts, never a Gmail.
    expect(r.logs.filter((l) => l.includes('could not'))).toHaveLength(1);
    expect(r.logs.join('\n')).not.toContain('@');
  });
});

describe('each edit', () => {
  it('goes to the list as the owner’s call for that Gmail, then the list is asked again', async () => {
    const r = rig();
    const approved = await r.list.approve(PERSON);
    expect(approved.ok).toBe(true);
    expect(approved.message).toContain(PERSON);
    expect(approved.message).toContain('token');
    expect(approved.view.people).toHaveLength(2);
    expect(r.made).toEqual([`approve ${PERSON}`, 'list']);

    r.made.length = 0;
    expect((await r.list.reject(PERSON)).message).toMatch(/^Rejected placeholder\.user@example\.com/u);
    expect((await r.list.regrant(PERSON)).message).toContain('new token');
    const revoked = await r.list.revoke(PERSON);
    expect(revoked.message).toContain('stops');
    expect((await r.list.note(PERSON, '  Placeholder note  ')).ok).toBe(true);
    expect(r.made).toEqual([
      `reject ${PERSON}`,
      'list',
      `regrant ${PERSON}`,
      'list',
      `revoke ${PERSON}`,
      'list',
      `note ${PERSON} Placeholder note`,
      'list',
    ]);
  });

  it('adds a Gmail as requested, and approves it at once when asked', async () => {
    const r = rig();
    const added = await r.list.add({
      gmail: ' new.placeholder@example.com ',
      name: 'Placeholder New',
      note: '',
      approve: false,
    });
    expect(added.ok).toBe(true);
    expect(added.message).toContain('new.placeholder@example.com');
    expect(r.made).toEqual(['add new.placeholder@example.com Placeholder New', 'list']);

    r.made.length = 0;
    const both = await r.list.add({
      gmail: 'two.placeholder@example.com',
      name: '',
      note: 'Placeholder note',
      approve: true,
    });
    expect(both.ok).toBe(true);
    expect(both.message).toContain('token');
    expect(r.made).toEqual([
      'add two.placeholder@example.com  Placeholder note',
      'approve two.placeholder@example.com',
      'list',
    ]);

    // A Gmail approved already: said as the owner needs it, nothing approved.
    r.made.length = 0;
    r.calls.add = () =>
      Promise.resolve({
        ok: false,
        kind: 'refused',
        error: 'already-approved',
        message: 'The list’s own words',
      });
    const again = await r.list.add({ gmail: PERSON, name: '', note: '', approve: true });
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toContain('give access again');
    expect(r.made).toEqual(['list']);
  });

  it('never revokes or rejects the owner’s own Gmail, however it is typed, and never calls the list for it', async () => {
    const r = rig();
    for (const typed of [OWNER, 'OWNER.placeholder@example.com', ' owner.placeholder@example.com ']) {
      expect(await r.list.revoke(typed)).toMatchObject({
        ok: false,
        message: ACCESS_ERROR_TEXT['owner-row'],
      });
      expect(await r.list.reject(typed)).toMatchObject({
        ok: false,
        message: ACCESS_ERROR_TEXT['owner-row'],
      });
    }
    // Nor a row the list says is the owner's.
    const f = fakeCalls([person({ gmail: 'second.owner@example.com', owner: true })]);
    const s = rig({ calls: f });
    await s.list.refresh();
    expect(await s.list.revoke('second.owner@example.com')).toMatchObject({ ok: false });
    expect(r.made.filter((m) => m.startsWith('revoke') || m.startsWith('reject'))).toEqual([]);
    expect(f.made.filter((m) => m.startsWith('revoke'))).toEqual([]);
  });

  it('takes only an address, and keeps a name and note to the list’s lengths', async () => {
    const r = rig();
    expect((await r.list.approve('not an address')).ok).toBe(false);
    expect((await r.list.add({ gmail: '', name: '', note: '', approve: false })).ok).toBe(false);
    expect(r.made).toEqual([]);
    await r.list.add({ gmail: PERSON, name: 'N'.repeat(80), note: 'n'.repeat(600), approve: false });
    await r.list.note(PERSON, 'm'.repeat(600));
    expect(r.made[0]).toBe(`add ${PERSON} ${'N'.repeat(60)} ${'n'.repeat(500)}`);
    expect(r.made[2]).toBe(`note ${PERSON} ${'m'.repeat(500)}`);
  });

  it('says a refusal in the owner’s words, and no answer as no answer, and asks the list again either way', async () => {
    const f = fakeCalls();
    f.calls.approve = () => refused('wrong-status');
    f.calls.revoke = () => noAnswer;
    const r = rig({ calls: f });
    const wrong = await r.list.approve(PERSON);
    expect(wrong).toMatchObject({ ok: false, message: ownerErrorText('wrong-status') });
    expect(wrong.view.people).toHaveLength(2);
    expect(await r.list.revoke(PERSON)).toMatchObject({ ok: false, message: EDIT_NO_ANSWER_TEXT });
    expect(r.made.filter((m) => m === 'list')).toHaveLength(2);
  });
});

describe('the CSV', () => {
  const people = [
    person({ gmail: OWNER, owner: true, shows: 3 }),
    person({ gmail: PERSON, name: 'Placeholder Person', shows: 7 }),
    person({ gmail: 'third.placeholder@example.com', status: 'requested' }),
  ];

  it('is the rows the window shows, in its order, made from the list’s own answer, saved where the owner chooses', async () => {
    const r = rig({ calls: fakeCalls(people) });
    await r.list.refresh();
    const saved = await r.list.exportCsv([
      'THIRD.placeholder@example.com',
      PERSON,
      'gone.placeholder@example.com',
    ]);
    expect(saved.ok).toBe(true);
    expect(saved.message).toContain('2 Gmails');
    expect(saved.message).toContain('Drashti access list.csv');
    expect(r.saved).toHaveLength(1);
    // The third, then the person: as the window showed them.
    const want = people.filter((p) => p.gmail !== OWNER).reverse();
    expect(r.saved[0]?.text).toBe(accessListCsv(want));
  });

  it('is not saved when the owner cancels, or before the list has answered, and a file problem is said plainly', async () => {
    const r = rig({ calls: fakeCalls(people) });
    expect(await r.list.exportCsv([PERSON])).toMatchObject({ ok: false });
    await r.list.refresh();
    r.saveAs.answer = null;
    expect(await r.list.exportCsv([PERSON])).toEqual({ ok: false, message: null });
    r.saveAs.answer = '/placeholder/full/drive.csv';
    const full = rig({
      calls: fakeCalls(people),
      deps: {
        write: () => {
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        },
      },
    });
    await full.list.refresh();
    expect(await full.list.exportCsv([PERSON])).toEqual({
      ok: false,
      message: 'The drive is full: free some space, or choose another drive.',
    });
    expect(r.saved).toEqual([]);
  });
});

describe('through Drashti’s client and the stand-in list (the list’s own rules)', () => {
  let standIn: AccessStandIn | null = null;
  afterEach(async () => {
    await standIn?.close();
    standIn = null;
  });

  it('lists every Gmail, adds, approves, revokes and gives access again, and the list itself refuses the owner’s row', async () => {
    const s = await accessStandIn();
    standIn = s;
    const computer = placeholderComputer('access-list-owner');
    const grant = s.grant(s.approver, computer);
    s.grant(PERSON, placeholderComputer('access-list-person'));
    const client = new AccessClient({
      url: s.url,
      publicKey: s.publicKey,
      computer,
      transport: nodeTransport,
      local: true,
    });
    const calls = ownerCalls(
      () => Promise.resolve(client),
      () => grant,
    );
    const list = new AccessList({
      calls: () => calls,
      isOwner: () => true,
      ownerGmail: () => s.approver,
      changed: () => undefined,
      now: () => Date.now(),
      saveAs: () => Promise.resolve(null),
      write: () => undefined,
      log: () => undefined,
    });
    const first = await list.refresh();
    expect(first.problem).toBeNull();
    expect(first.people?.map((p) => [p.gmail, p.status, p.owner])).toEqual([
      [s.approver, 'approved', true],
      [PERSON, 'approved', false],
    ]);

    const added = await list.add({
      gmail: 'new.placeholder@example.com',
      name: 'Placeholder New',
      note: '',
      approve: true,
    });
    expect(added.ok).toBe(true);
    expect(added.view.people?.find((p) => p.gmail === 'new.placeholder@example.com')).toMatchObject({
      name: 'Placeholder New',
      status: 'approved',
    });
    expect(s.list.tokenFor('new.placeholder@example.com')).not.toBeNull();

    const revoked = await list.revoke(PERSON);
    expect(revoked.ok).toBe(true);
    expect(revoked.view.people?.find((p) => p.gmail === PERSON)?.status).toBe('revoked');
    const again = await list.regrant(PERSON);
    expect(again.ok).toBe(true);
    expect(again.view.people?.find((p) => p.gmail === PERSON)?.status).toBe('approved');
    expect(
      (await list.note(PERSON, 'Placeholder note')).view.people?.find((p) => p.gmail === PERSON)?.note,
    ).toBe('Placeholder note');

    // Past Drashti's own check, the list refuses Revoke and Reject on the owner's row itself.
    const direct = await calls.revoke(s.approver);
    expect(direct).toMatchObject({ ok: false, kind: 'refused', error: 'owner-row' });
    // And another Gmail's computer, let in and signing with its own grant, is not the owner's.
    const third = placeholderComputer('access-list-third');
    const thirdGrant = s.grant('third.placeholder@example.com', third);
    const thirdClient = new AccessClient({
      url: s.url,
      publicKey: s.publicKey,
      computer: third,
      transport: nodeTransport,
      local: true,
    });
    const other = ownerCalls(
      () => Promise.resolve(thirdClient),
      () => thirdGrant,
    );
    expect(await other.list()).toMatchObject({ ok: false, kind: 'refused', error: 'not-owner' });
    expect(await other.revoke(PERSON)).toMatchObject({ ok: false, kind: 'refused', error: 'not-owner' });
    // With no grant kept, or no client (no id for this computer), nothing is sent.
    const calledBefore = s.calls.length;
    const none = ownerCalls(
      () => Promise.resolve(client),
      () => null,
    );
    expect(await none.list()).toMatchObject({ ok: false, kind: 'refused', error: 'not-owner' });
    const noClient = ownerCalls(
      () => Promise.resolve(null),
      () => grant,
    );
    expect(await noClient.revoke(PERSON)).toMatchObject({ ok: false, kind: 'no-answer' });
    expect(s.calls.length).toBe(calledBefore);
  });
});
