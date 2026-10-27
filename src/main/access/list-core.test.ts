import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  callBody,
  COMPUTERS,
  core,
  linkParams,
  makeTestKeys,
  NO_ACTIVITY,
  PEOPLE,
  PLACEHOLDER_APPROVER,
  placeholderComputer,
  readAnswer,
  TestList,
  type AnswerPayload,
  type TestKeys,
} from '../../../tests/access-core';
import type { AccessActivity, AccessComputer, AccessGrant } from '../../shared/access-protocol';

/*
 * The access list's rules (Session 54, E1): access-list/core.js, the same file the owner pastes into their
 * Google account, run here with a Sheet, a mailbox, a cache and a clock in memory (tests/access-core.ts).
 * Placeholder addresses and computers only.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PERSON = 'placeholder.user@example.com';
const OTHER = 'placeholder.other@example.com';

let keys: TestKeys;
beforeAll(() => {
  keys = makeTestKeys();
});

const newList = (o: { mailQuota?: number } = {}) => new TestList({ keys, ...o });

/** A placeholder computer calling the list, every answer's signature, op, nonce and computer id checked. */
class Computer {
  at = Date.UTC(2026, 9, 27, 10, 0, 0);

  constructor(
    readonly list: TestList,
    readonly computer: AccessComputer,
  ) {}

  call(op: string, fields: Record<string, unknown>, grant?: AccessGrant): AnswerPayload {
    const { body, nonce } = callBody(op, this.computer, fields, grant);
    const answer = readAnswer(this.list.handle(JSON.stringify(body)), this.list.keys.publicKey);
    expect(answer).toMatchObject({ v: 1, op, nonce, computerId: this.computer.id, serverTime: this.list.t });
    return answer;
  }

  request(gmail: string, name?: string): AnswerPayload {
    return this.call('request', { gmail, ...(name === undefined ? {} : { name }) });
  }

  status(gmail: string): AnswerPayload {
    return this.call('status', { gmail });
  }

  redeem(gmail: string, token: string): AnswerPayload {
    return this.call('redeem', { gmail, token });
  }

  /** Redeem a token that must work: the grant to sign checks with. */
  letIn(gmail: string, token: string): AccessGrant {
    const a = this.redeem(gmail, token);
    expect(a).toMatchObject({ ok: true });
    return { gmail, grantId: String(a['grantId']), secret: String(a['secret']) };
  }

  check(grant: AccessGrant, activity: AccessActivity = NO_ACTIVITY): AnswerPayload {
    this.at += SECOND;
    return this.call('check', { at: this.at, activity }, grant);
  }

  owner(op: string, grant: AccessGrant, fields: Record<string, unknown> = {}): AnswerPayload {
    this.at += SECOND;
    return this.call(op, { at: this.at, ...fields }, grant);
  }
}

const mac = (n: number) => new Computer(new TestList({ keys }), placeholderComputer(`mac-${String(n)}`));

/** Ask, approve by the link in the approver's email, and come in with the token: the grant. */
function approved(list: TestList, computer: Computer, gmail = PERSON): AccessGrant {
  expect(computer.request(gmail, 'Placeholder Person')).toMatchObject({ ok: true, status: 'requested' });
  const links = list.linksFor(gmail);
  if (!links) throw new Error('No links');
  expect(core.answerLink(list.env, linkParams(links.approve))).toMatchObject({
    kind: 'done',
    title: 'Approved',
  });
  const token = list.tokenFor(gmail);
  if (!token) throw new Error('No token');
  return computer.letIn(gmail, token);
}

/** The owner let in through Let me in (the owner) on the Sheet's menu. */
function ownerIn(list: TestList, computer: Computer): AccessGrant {
  core.letOwnerIn(list.env);
  const token = list.tokenFor(PLACEHOLDER_APPROVER);
  if (!token) throw new Error('No token');
  return computer.letIn(PLACEHOLDER_APPROVER, token);
}

const row = (list: TestList, gmail: string) => list.sheet.find(PEOPLE, 'Gmail', gmail);

describe('every answer', () => {
  it('is signed, and echoes the op, the nonce and the computer id (ASCII only, whatever was typed)', () => {
    const list = newList();
    const c = new Computer(list, { ...placeholderComputer('mac-ascii'), name: 'Placeholderी Mac ✓' });
    const a = c.request(PERSON, 'Placeholder નામ 😀');
    expect(a).toMatchObject({ ok: true, status: 'requested' });
    const { payload } = list.handle(JSON.stringify(callBody('status', c.computer, { gmail: PERSON }).body));
    expect(/^[\x20-\x7e]*$/u.test(payload)).toBe(true);
    expect(row(list, PERSON)?.['Name']).toBe('Placeholder નામ 😀');
  });

  it('says bad-request for what is not a call, still signed, echoing what it could', () => {
    const list = newList();
    for (const text of ['', 'not json', '[]', JSON.stringify({ v: 2, op: 'status' }), 'x'.repeat(20_000)]) {
      const a = readAnswer(list.handle(text), keys.publicKey);
      expect(a).toMatchObject({ ok: false, error: 'bad-request' });
    }
    const c = placeholderComputer('mac-version');
    const { body, nonce } = callBody('status', c, { gmail: PERSON });
    const a = readAnswer(list.handle(JSON.stringify({ ...body, v: 2 })), keys.publicKey);
    expect(a).toMatchObject({ ok: false, error: 'bad-request', nonce, computerId: c.id, op: 'status' });
    const noNonce = readAnswer(list.handle(JSON.stringify({ ...body, nonce: 'short' })), keys.publicKey);
    expect(noNonce).toMatchObject({ ok: false, error: 'bad-request', nonce: '' });
  });

  it('says bad-gmail for an address the list does not take', () => {
    const c = mac(1);
    for (const gmail of [
      '',
      'no-at-sign',
      '@example.com',
      'a@b',
      'pläce@example.com',
      `${'a'.repeat(250)}@example.com`,
    ])
      expect(c.request(gmail)).toMatchObject({ ok: false, error: 'bad-gmail' });
  });

  it('is not signed before the list is set up (so Drashti believes none of it)', () => {
    const list = newList();
    list.props.hasSigningKey = false;
    const answer = list.handle(
      JSON.stringify(callBody('status', placeholderComputer('m'), { gmail: PERSON }).body),
    );
    expect(answer.sig).toBe('');
    expect(JSON.parse(answer.payload)).toMatchObject({ ok: false, error: 'not-set-up' });
  });

  it('says server, with what to do, when a tab or a column of the Sheet is missing', () => {
    const list = newList();
    list.sheet.tabs.delete(COMPUTERS);
    const c = new Computer(list, placeholderComputer('mac-broken'));
    expect(c.request(PERSON)).toMatchObject({
      ok: false,
      error: 'server',
      message: expect.stringContaining('Set up') as unknown,
    });
    list.sheet.tabs.set(COMPUTERS, [['Gmail']]);
    expect(c.request(OTHER)).toMatchObject({
      ok: false,
      error: 'server',
      message: expect.stringContaining('Set up') as unknown,
    });
  });

  it('says server, and logs what failed, when something inside throws', () => {
    const list = newList();
    list.env.sheet.read = () => {
      throw new Error('Placeholder Sheet failure');
    };
    expect(new Computer(list, placeholderComputer('mac-throws')).request(PERSON)).toMatchObject({
      ok: false,
      error: 'server',
      message: core.MESSAGES['server'],
    });
    expect(list.logs.join('\n')).toContain('Placeholder Sheet failure');
  });

  it('says busy when the list’s lock is held too long', () => {
    const c = mac(2);
    c.list.lockBusy = true;
    expect(c.request(PERSON)).toMatchObject({ ok: false, error: 'busy' });
  });
});

describe('a request', () => {
  it('makes a requested row and emails the approver the Gmail, name, computer and both links', () => {
    const c = mac(3);
    const list = c.list;
    expect(c.request(`  ${PERSON}  `, '  Placeholder   Person ')).toMatchObject({
      ok: true,
      status: 'requested',
      mailed: true,
    });
    expect(row(list, PERSON)).toMatchObject({
      Gmail: PERSON,
      Name: 'Placeholder Person',
      Status: 'requested',
    });
    expect(row(list, PERSON)?.['Requested']).toEqual(new Date(list.t));
    const [mail] = list.mailTo(PLACEHOLDER_APPROVER);
    expect(mail?.subject).toBe(`Drashti: ${PERSON} asks for access`);
    expect(mail?.body).toContain('Name they typed: Placeholder Person');
    expect(mail?.body).toContain('Computer: Placeholder Mac (Drashti 1.0.0-alpha.13, Mac)');
    expect(mail?.body).toMatch(
      /Approve: https:\/\/script\.google\.com\/macros\/s\/placeholder-list\/exec\?a=approve&r=[0-9a-f]{32}&x=\d+&s=[0-9a-f]{64}/u,
    );
    expect(mail?.body).toMatch(/Reject: \S+\?a=reject&/u);
    expect(list.mailbox).toHaveLength(1);
  });

  it('keeps names one plain line: no hidden characters, no formula, at most 60 letters', () => {
    const c = mac(4);
    c.request(PERSON, '=HYPERLINK("http://placeholder.example")\u202e\n\tPlaceholder');
    expect(row(c.list, PERSON)?.['Name']).toBe('HYPERLINK("http://placeholder.example") Placeholder');
    c.list.move(DAY);
    c.request(PERSON, 'ક્ષ'.repeat(40));
    const name = String(row(c.list, PERSON)?.['Name']);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toBe('ક્ષ'.repeat(20));
  });

  it('asked again replaces the request: the first email’s links say so, the newest work', () => {
    const c = mac(5);
    c.request(PERSON);
    const first = c.list.linksFor(PERSON);
    c.list.move(MINUTE);
    c.request(PERSON);
    const second = c.list.linksFor(PERSON);
    expect(second?.approve).not.toBe(first?.approve);
    expect(core.linkPage(c.list.env, linkParams(first?.approve ?? ''))).toMatchObject({
      kind: 'replaced',
      button: null,
    });
    expect(core.answerLink(c.list.env, linkParams(first?.approve ?? ''))).toMatchObject({ kind: 'replaced' });
    expect(core.linkPage(c.list.env, linkParams(second?.approve ?? ''))).toMatchObject({
      kind: 'ready',
      button: 'Approve',
    });
  });

  it('for a Gmail approved, with a computer in or a token waiting, answers already-approved and emails nobody', () => {
    const c = mac(6);
    approved(c.list, c);
    const before = c.list.mailbox.length;
    expect(new Computer(c.list, placeholderComputer('mac-6b')).request(PERSON)).toMatchObject({
      ok: false,
      error: 'already-approved',
    });
    expect(c.list.mailbox).toHaveLength(before);
  });

  it('for a Gmail approved whose token ran out unused, is made like any other', () => {
    const c = mac(7);
    c.request(PERSON);
    core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.approve ?? ''));
    expect(c.request(PERSON)).toMatchObject({ ok: false, error: 'already-approved' });
    c.list.move(3 * DAY + MINUTE);
    expect(c.request(PERSON)).toMatchObject({ ok: true, status: 'requested' });
    expect(row(c.list, PERSON)?.['Status']).toBe('requested');
  });

  it('is limited: 3 a day for one Gmail, 10 from one computer, 50 in all', () => {
    const c = mac(8);
    for (let i = 0; i < 3; i++) expect(c.request(PERSON)).toMatchObject({ ok: true });
    expect(c.request(PERSON)).toMatchObject({ ok: false, error: 'too-many' });
    for (let i = 0; i < 7; i++)
      expect(c.request(`placeholder.${String(i)}@example.com`)).toMatchObject({ ok: true });
    expect(c.request('placeholder.more@example.com')).toMatchObject({ ok: false, error: 'too-many' });
    c.list.move(DAY);
    expect(c.request(PERSON)).toMatchObject({ ok: true });

    const all = newList();
    for (let i = 0; i < 50; i++)
      expect(
        new Computer(all, placeholderComputer(`mac-all-${String(i)}`)).request(
          `placeholder.all${String(i)}@example.com`,
        ),
      ).toMatchObject({ ok: true });
    expect(
      new Computer(all, placeholderComputer('mac-all-x')).request('placeholder.x@example.com'),
    ).toMatchObject({
      ok: false,
      error: 'too-many',
    });
  });

  it('naming the owner’s own Gmail is refused, and never demotes the owner’s row (Let me in is its way in)', () => {
    const c = mac(30);
    const list = c.list;
    // No row yet: none is made, and the approver is not emailed.
    expect(c.request(PLACEHOLDER_APPROVER)).toMatchObject({ ok: false, error: 'owner-row' });
    expect(row(list, PLACEHOLDER_APPROVER)).toBeUndefined();
    // Approved, its token run out unused and no computer in: still approved, nothing asked, nobody emailed.
    core.letOwnerIn(list.env);
    list.move(3 * DAY + MINUTE);
    const before = row(list, PLACEHOLDER_APPROVER);
    const mails = list.mailbox.length;
    expect(c.request(PLACEHOLDER_APPROVER.toUpperCase(), 'Placeholder Stranger')).toMatchObject({
      ok: false,
      error: 'owner-row',
    });
    expect(row(list, PLACEHOLDER_APPROVER)).toEqual(before);
    expect(list.mailbox).toHaveLength(mails);
    expect(c.status(PLACEHOLDER_APPROVER)).toMatchObject({ ok: true, status: 'unknown' });
  });

  it('is kept even when the day’s emails are used up (mailed: false), so the owner still sees it', () => {
    const c = new Computer(newList({ mailQuota: 0 }), placeholderComputer('mac-quota'));
    expect(c.request(PERSON)).toMatchObject({ ok: true, status: 'requested', mailed: false });
    expect(row(c.list, PERSON)?.['Status']).toBe('requested');
  });

  it('matches a Gmail however it is written: dots, +words and googlemail.com are one mailbox, one row', () => {
    const c = mac(9);
    c.request('Placeholder.User+drashti@GoogleMail.com');
    c.list.move(MINUTE);
    c.request('placeholderuser@gmail.com');
    expect(c.list.sheet.records(PEOPLE)).toHaveLength(1);
    expect(row(c.list, 'Placeholder.User+drashti@GoogleMail.com')?.['Status']).toBe('requested');
  });
});

describe('the Approve and Reject links', () => {
  it('open a page with one button that changes nothing; pressing Approve emails the token and approves', () => {
    const c = mac(10);
    c.request(PERSON, 'Placeholder Person');
    const links = c.list.linksFor(PERSON);
    const page = core.linkPage(c.list.env, linkParams(links?.approve ?? ''));
    expect(page).toMatchObject({ kind: 'ready', title: `Approve ${PERSON}?`, button: 'Approve' });
    expect(page.lines.join('\n')).toContain('Placeholder Person');
    // Opened again (an email scanner): still nothing done.
    core.linkPage(c.list.env, linkParams(links?.approve ?? ''));
    expect(row(c.list, PERSON)?.['Status']).toBe('requested');
    expect(c.list.tokenFor(PERSON)).toBeNull();
    expect(core.answerLink(c.list.env, linkParams(links?.approve ?? ''))).toMatchObject({
      kind: 'done',
      title: 'Approved',
    });
    expect(row(c.list, PERSON)).toMatchObject({ Status: 'approved', Approved: new Date(c.list.t) });
    expect(c.list.tokenFor(PERSON)).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/u);
    expect(c.status(PERSON)).toMatchObject({ ok: true, status: 'approved', tokenWaiting: true });
  });

  it('work once: Approve or Reject pressed again says it was answered, and sends nothing more', () => {
    const c = mac(11);
    c.request(PERSON);
    const links = c.list.linksFor(PERSON);
    core.answerLink(c.list.env, linkParams(links?.approve ?? ''));
    const mails = c.list.mailbox.length;
    expect(core.answerLink(c.list.env, linkParams(links?.approve ?? ''))).toMatchObject({ kind: 'used' });
    expect(core.answerLink(c.list.env, linkParams(links?.reject ?? ''))).toMatchObject({ kind: 'used' });
    expect(core.linkPage(c.list.env, linkParams(links?.reject ?? ''))).toMatchObject({
      kind: 'used',
      button: null,
    });
    expect(c.list.mailbox).toHaveLength(mails);
    expect(row(c.list, PERSON)?.['Status']).toBe('approved');
  });

  it('refuse one that is forged: its signature, request, action or date changed', () => {
    const c = mac(12);
    c.request(PERSON);
    const p = linkParams(c.list.linksFor(PERSON)?.reject ?? '');
    const flip = (s: string) => `${s.slice(0, -1)}${s.endsWith('0') ? '1' : '0'}`;
    for (const forged of [
      { ...p, s: flip(p['s'] ?? '') },
      { ...p, r: flip(p['r'] ?? '') },
      { ...p, a: 'approve' },
      { ...p, x: String(Number(p['x']) + DAY) },
      { a: 'approve' },
      {},
    ]) {
      expect(core.linkPage(c.list.env, forged)).toMatchObject({ kind: 'forged', button: null });
      expect(core.answerLink(c.list.env, forged)).toMatchObject({ kind: 'forged' });
    }
    expect(row(c.list, PERSON)?.['Status']).toBe('requested');
  });

  it('run out after 7 days', () => {
    const c = mac(13);
    c.request(PERSON);
    const p = linkParams(c.list.linksFor(PERSON)?.approve ?? '');
    c.list.move(7 * DAY - MINUTE);
    expect(core.linkPage(c.list.env, p)).toMatchObject({ kind: 'ready' });
    c.list.move(2 * MINUTE);
    expect(core.linkPage(c.list.env, p)).toMatchObject({ kind: 'out-of-date', button: null });
    expect(core.answerLink(c.list.env, p)).toMatchObject({ kind: 'out-of-date' });
    expect(c.list.tokenFor(PERSON)).toBeNull();
  });

  it('Reject marks the row rejected, tells the person plainly, and status says so to the computer that asked', () => {
    const c = mac(14);
    c.request(PERSON);
    expect(core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.reject ?? ''))).toMatchObject({
      kind: 'done',
      title: 'Rejected',
    });
    expect(row(c.list, PERSON)).toMatchObject({ Status: 'rejected', Rejected: new Date(c.list.t) });
    expect(c.list.mailTo(PERSON).at(-1)).toMatchObject({ subject: 'Your Drashti request' });
    expect(c.list.mailTo(PERSON).at(-1)?.body).toContain('was not approved');
    expect(c.status(PERSON)).toMatchObject({ ok: true, status: 'rejected' });
    expect(c.list.tokenFor(PERSON)).toBeNull();
  });

  it('never reject the owner’s own row, even a request on it typed in the Sheet', () => {
    const list = newList();
    core.letOwnerIn(list.env);
    // A request on the owner's row, as only a hand in the Sheet can make one now.
    const r = '7'.repeat(32);
    list.sheet.type(PEOPLE, 'Gmail', PLACEHOLDER_APPROVER, 'Request', r);
    list.sheet.type(PEOPLE, 'Gmail', PLACEHOLDER_APPROVER, 'Request at', new Date(list.t));
    const x = String(list.t + DAY);
    const s = createHmac('sha256', Buffer.from(list.props.linkKey, 'utf8'))
      .update(`drashti-link\nreject\n${r}\n${x}`, 'utf8')
      .digest('hex');
    expect(core.answerLink(list.env, { a: 'reject', r, x, s })).toMatchObject({
      kind: 'refused',
      lines: [core.MESSAGES['owner-row']],
    });
    expect(row(list, PLACEHOLDER_APPROVER)?.['Status']).toBe('approved');
  });

  it('say so when the day’s emails are used up, and change nothing', () => {
    const c = new Computer(newList({ mailQuota: 1 }), placeholderComputer('mac-limit'));
    c.request(PERSON);
    expect(core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.approve ?? ''))).toMatchObject({
      kind: 'refused',
      lines: [core.MESSAGES['mail-limit']],
    });
    expect(row(c.list, PERSON)?.['Status']).toBe('requested');
    expect(c.list.sheet.records(COMPUTERS)).toHaveLength(0);
  });
});

describe('status', () => {
  it('answers only the computer that asked', () => {
    const c = mac(16);
    c.request(PERSON);
    expect(c.status(PERSON)).toMatchObject({ ok: true, status: 'requested', tokenWaiting: false });
    expect(new Computer(c.list, placeholderComputer('mac-16b')).status(PERSON)).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    expect(c.status(OTHER)).toMatchObject({ ok: true, status: 'unknown' });
  });
});

describe('a token', () => {
  it('lets one computer in, once', () => {
    const c = mac(17);
    c.request(PERSON);
    core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.approve ?? ''));
    const token = c.list.tokenFor(PERSON) ?? '';
    const a = c.redeem(PERSON, token);
    expect(a).toMatchObject({ ok: true, owner: false });
    expect(a['grantId']).toMatch(/^[0-9a-f]{32}$/u);
    expect(a['secret']).toMatch(/^[0-9a-f]{64}$/u);
    expect(c.redeem(PERSON, token)).toMatchObject({ ok: false, error: 'bad-token' });
    expect(new Computer(c.list, placeholderComputer('mac-17b')).redeem(PERSON, token)).toMatchObject({
      ok: false,
      error: 'bad-token',
    });
    expect(c.list.sheet.find(COMPUTERS, 'Gmail', PERSON)).toMatchObject({
      Computer: 'Placeholder Mac',
      Version: '1.0.0-alpha.13',
      Platform: 'darwin',
      'Token used': new Date(c.list.t),
      'Computer id': c.computer.id,
    });
  });

  it('works only for its own Gmail', () => {
    const list = newList();
    const a = new Computer(list, placeholderComputer('mac-a'));
    const b = new Computer(list, placeholderComputer('mac-b'));
    approved(list, a, OTHER);
    b.request(PERSON);
    core.answerLink(list.env, linkParams(list.linksFor(PERSON)?.approve ?? ''));
    expect(b.redeem(OTHER, list.tokenFor(PERSON) ?? '')).toMatchObject({ ok: false, error: 'bad-token' });
    expect(b.redeem(PERSON, list.tokenFor(PERSON) ?? '')).toMatchObject({ ok: true });
  });

  it('never works after a revoke, nor after a newer grant', () => {
    const list = newList();
    const owner = new Computer(list, placeholderComputer('mac-owner'));
    const me = ownerIn(list, owner);
    const c = new Computer(list, placeholderComputer('mac-person'));
    c.request(PERSON);
    core.answerLink(list.env, linkParams(list.linksFor(PERSON)?.approve ?? ''));
    const first = list.tokenFor(PERSON) ?? '';
    expect(owner.owner('regrant', me, { target: PERSON })).toMatchObject({ ok: true, status: 'approved' });
    const second = list.tokenFor(PERSON) ?? '';
    expect(second).not.toBe(first);
    expect(c.redeem(PERSON, first)).toMatchObject({ ok: false, error: 'bad-token' });
    expect(list.sheet.records(COMPUTERS).find((r) => r['Why ended'] === 'replaced')).toBeDefined();
    expect(owner.owner('revoke', me, { target: PERSON })).toMatchObject({ ok: true, status: 'revoked' });
    expect(c.redeem(PERSON, second)).toMatchObject({ ok: false, error: 'bad-token' });
  });

  it('runs out 3 days after it is sent', () => {
    const c = mac(18);
    c.request(PERSON);
    core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.approve ?? ''));
    const token = c.list.tokenFor(PERSON) ?? '';
    c.list.move(3 * DAY + SECOND);
    expect(c.redeem(PERSON, token)).toMatchObject({ ok: false, error: 'bad-token' });

    const d = mac(19);
    d.request(PERSON);
    core.answerLink(d.list.env, linkParams(d.list.linksFor(PERSON)?.approve ?? ''));
    d.list.move(3 * DAY - SECOND);
    expect(d.redeem(PERSON, d.list.tokenFor(PERSON) ?? '')).toMatchObject({ ok: true });
  });

  it('is taken as typed by a person: lower case, spaces for dashes, O for 0, I or L for 1', () => {
    const c = mac(20);
    c.request(PERSON);
    core.answerLink(c.list.env, linkParams(c.list.linksFor(PERSON)?.approve ?? ''));
    const token = c.list.tokenFor(PERSON) ?? '';
    const typed = ` ${token.toLowerCase().replace(/-/gu, ' ').replace(/0/gu, 'o').replace(/1/gu, 'l')} `;
    expect(c.redeem(PERSON, typed)).toMatchObject({ ok: true });
  });

  it('is never kept in the Sheet: only its hash is', () => {
    const c = mac(21);
    approved(c.list, c);
    const token = c.list.tokenFor(PERSON) ?? '';
    const cells = JSON.stringify([...c.list.sheet.tabs.values()]);
    expect(cells).not.toContain(token);
    expect(cells).not.toContain(token.replace(/-/gu, ''));
    expect(c.list.sheet.find(COMPUTERS, 'Gmail', PERSON)?.['Token hash']).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('answers the same bad-token whatever was wrong, and allows 10 tries an hour for a Gmail and a computer', () => {
    const c = mac(22);
    c.request(PERSON);
    const wrongs = ['', 'not a token', '0000-0000-0000-0000-0000-0000-0000', 'x'.repeat(100)];
    for (const w of wrongs)
      expect(c.redeem(PERSON, w)).toMatchObject({
        ok: false,
        error: 'bad-token',
        message: core.MESSAGES['bad-token'],
      });
    for (let i = wrongs.length; i < 10; i++) c.redeem(PERSON, wrongs[0] ?? '');
    expect(c.redeem(PERSON, '')).toMatchObject({ ok: false, error: 'too-many' });
    // Another computer, the same Gmail: the Gmail's 10 are used too.
    expect(new Computer(c.list, placeholderComputer('mac-22b')).redeem(PERSON, '')).toMatchObject({
      error: 'too-many',
    });
    // The same computer, another Gmail: the computer's 10 are used.
    expect(c.redeem(OTHER, '')).toMatchObject({ error: 'too-many' });
    c.list.move(HOUR);
    expect(c.redeem(PERSON, '')).toMatchObject({ error: 'bad-token' });
  });

  it('two computers of one Gmail each need their own grant; a new grant never ends a computer already in', () => {
    const list = newList();
    const owner = new Computer(list, placeholderComputer('mac-owner-2'));
    const me = ownerIn(list, owner);
    const first = new Computer(list, placeholderComputer('mac-first'));
    const grant1 = approved(list, first);
    const second = new Computer(list, placeholderComputer('mac-second'));
    expect(second.request(PERSON)).toMatchObject({ ok: false, error: 'already-approved' });
    owner.owner('regrant', me, { target: PERSON });
    const grant2 = second.letIn(PERSON, list.tokenFor(PERSON) ?? '');
    expect(first.check(grant1)).toMatchObject({ status: 'in' });
    expect(second.check(grant2)).toMatchObject({ status: 'in' });
    expect(row(list, PERSON)?.['Computers']).toBe('Placeholder Mac, Placeholder Mac');
  });
});

describe('a check', () => {
  it('answers in to the computer let in, and owner only to the owner’s', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-check'));
    const grant = approved(list, c);
    expect(c.check(grant)).toMatchObject({ ok: true, status: 'in', owner: false });
    const o = new Computer(list, placeholderComputer('mac-check-owner'));
    expect(o.check(ownerIn(list, o))).toMatchObject({ ok: true, status: 'in', owner: true });
  });

  it('answers unknown to a wrong mac, another computer (a copied data folder), another Gmail or a grant not known', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-real'));
    const grant = approved(list, c);
    const copy = new Computer(list, placeholderComputer('mac-copy'));
    expect(copy.check(grant)).toMatchObject({ ok: true, status: 'unknown', owner: false });
    expect(
      c.check({ ...grant, secret: grant.secret.replace(/^./u, (x) => (x === 'a' ? 'b' : 'a')) }),
    ).toMatchObject({
      status: 'unknown',
    });
    expect(c.check({ ...grant, gmail: OTHER })).toMatchObject({ status: 'unknown' });
    expect(c.check({ ...grant, grantId: '0'.repeat(32) })).toMatchObject({ status: 'unknown' });
    // The mac covers the whole call: the activity changed after signing is refused.
    const { body } = callBody('check', c.computer, { at: c.at + 5 * SECOND, activity: NO_ACTIVITY }, grant);
    const changed = { ...body, activity: { ...NO_ACTIVITY, shows: 99 } };
    expect(readAnswer(list.handle(JSON.stringify(changed)), keys.publicKey)).toMatchObject({
      status: 'unknown',
    });
    list.move(10 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'in' });
  });

  it('answers revoked at the next check after the owner revokes, and rejected or unknown as the Sheet says', () => {
    const list = newList();
    const owner = new Computer(list, placeholderComputer('mac-o'));
    const me = ownerIn(list, owner);
    const c = new Computer(list, placeholderComputer('mac-r'));
    const grant = approved(list, c);
    expect(c.check(grant)).toMatchObject({ status: 'in' });
    owner.owner('revoke', me, { target: PERSON });
    list.move(6 * SECOND);
    // At once: the list's write drops what it had read before.
    expect(c.check(grant)).toMatchObject({ status: 'revoked', owner: false });
    expect(row(list, PERSON)).toMatchObject({
      Status: 'revoked',
      Revoked: expect.any(Date) as unknown,
      Computers: '',
    });
    expect(list.sheet.find(COMPUTERS, 'Gmail', PERSON)).toMatchObject({ 'Why ended': 'revoked' });
  });

  it('reads a status typed in the Sheet within 10 seconds; typed revoked ends the computers for good', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-typed'));
    const grant = approved(list, c);
    expect(c.check(grant)).toMatchObject({ status: 'in' });
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', ' Revoked ');
    list.move(6 * SECOND);
    // Still what the list read 6 s ago…
    expect(c.check(grant)).toMatchObject({ status: 'in' });
    list.move(6 * SECOND);
    // …and the edit 12 s later.
    expect(c.check(grant)).toMatchObject({ status: 'revoked' });
    expect(row(list, PERSON)).toMatchObject({ 'Status seen': 'revoked', Revoked: new Date(list.t) });
    expect(list.sheet.find(COMPUTERS, 'Gmail', PERSON)).toMatchObject({ 'Why ended': 'revoked' });
    // Typed approved again: the computers ended stay out (Give access again lets one back in).
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', 'approved');
    list.move(11 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'revoked' });
  });

  it('reads rejected, a removed row and a changed Gmail as stopping too', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-rej'));
    const grant = approved(list, c);
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', 'rejected');
    list.move(11 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'rejected' });

    const list2 = newList();
    const d = new Computer(list2, placeholderComputer('mac-gone'));
    const grant2 = approved(list2, d);
    list2.sheet.type(PEOPLE, 'Gmail', PERSON, 'Gmail', 'placeholder.renamed@example.com');
    list2.move(11 * SECOND);
    expect(d.check(grant2)).toMatchObject({ status: 'unknown' });
  });

  it('a status typed that the list does not know stops the computers, without ending them', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-typo'));
    const grant = approved(list, c);
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', 'paused');
    list.move(11 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'unknown' });
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', 'approved');
    list.move(11 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'in' });
  });

  it('records last seen, the version and the totals at most once a minute, and never an older call again', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-record'));
    const grant = approved(list, c);
    list.move(MINUTE);
    expect(c.check(grant, { minutes: 5, shows: 2, streams: 1, recordings: 1, imports: 3 })).toMatchObject({
      status: 'in',
      recorded: true,
    });
    const seen = list.t;
    list.move(15 * SECOND);
    expect(c.check(grant, { minutes: 6, shows: 2, streams: 1, recordings: 1, imports: 3 })).toMatchObject({
      recorded: false,
    });
    list.move(46 * SECOND);
    // A call made before the last one recorded (a replay) records nothing.
    c.at -= 10 * SECOND;
    expect(c.check(grant, { minutes: 1, shows: 0, streams: 0, recordings: 0, imports: 0 })).toMatchObject({
      status: 'in',
      recorded: false,
    });
    c.at += 20 * SECOND;
    list.move(5 * SECOND);
    expect(c.check(grant, { minutes: 7, shows: 3, streams: 1, recordings: 1, imports: 3 })).toMatchObject({
      recorded: true,
    });
    expect(list.sheet.find(COMPUTERS, 'Gmail', PERSON)).toMatchObject({
      'Last seen': new Date(list.t),
      'Minutes used': 7,
      Shows: 3,
      Streams: 1,
      Recordings: 1,
      Imports: 3,
      'Last at': c.at,
    });
    expect(row(list, PERSON)).toMatchObject({
      'Last seen': new Date(list.t),
      Version: '1.0.0-alpha.13',
      'Minutes used': 7,
      Shows: 3,
      Computers: 'Placeholder Mac',
    });
    expect(seen).toBeLessThan(list.t);
  });

  it('allows one counted check a computer every 5 seconds; unsigned calls never use a computer’s up', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-gap'));
    const grant = approved(list, c);
    expect(c.check(grant)).toMatchObject({ status: 'in' });
    list.move(2 * SECOND);
    expect(c.check(grant)).toMatchObject({ ok: false, error: 'too-many' });
    list.move(5 * SECOND);
    // Someone else, with this computer's id but not its secret.
    expect(c.check({ ...grant, secret: '0'.repeat(64) })).toMatchObject({ status: 'unknown' });
    expect(c.check(grant)).toMatchObject({ status: 'in' });
  });

  it('works the same when Google empties the cache at any moment', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-cache'));
    const grant = approved(list, c);
    for (let i = 0; i < 5; i++) {
      list.cache.clear();
      list.move(6 * SECOND);
      expect(c.check(grant)).toMatchObject({ status: 'in' });
    }
    list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', 'revoked');
    list.cache.clear();
    list.move(6 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'revoked' });
  });

  it('writes the right rows after the owner sorts the Sheet or puts a column of their own first', () => {
    const list = newList();
    const a = new Computer(list, placeholderComputer('mac-sort-a'));
    const b = new Computer(list, placeholderComputer('mac-sort-b'));
    const ga = approved(list, a, 'placeholder.a@example.com');
    const gb = approved(list, b, 'placeholder.z@example.com');
    list.move(MINUTE);
    a.check(ga, { ...NO_ACTIVITY, shows: 1 });
    b.check(gb, { ...NO_ACTIVITY, shows: 2 });
    list.sheet.sortBy(PEOPLE, 'Gmail');
    list.sheet.sortBy(COMPUTERS, 'Gmail');
    list.sheet.insertFirstColumn(COMPUTERS, 'My own column');
    list.move(MINUTE);
    expect(a.check(ga, { ...NO_ACTIVITY, shows: 10 })).toMatchObject({ status: 'in', recorded: true });
    expect(b.check(gb, { ...NO_ACTIVITY, shows: 20 })).toMatchObject({ status: 'in', recorded: true });
    expect(list.sheet.find(COMPUTERS, 'Gmail', 'placeholder.a@example.com')?.['Shows']).toBe(10);
    expect(list.sheet.find(COMPUTERS, 'Gmail', 'placeholder.z@example.com')?.['Shows']).toBe(20);
    expect(row(list, 'placeholder.a@example.com')?.['Shows']).toBe(10);
    expect(row(list, 'placeholder.z@example.com')?.['Shows']).toBe(20);
    expect(list.sheet.find(COMPUTERS, 'Gmail', 'placeholder.a@example.com')?.['My own column']).toBe('');
  });

  it('reads the Sheet at most every 10 seconds while nothing is written', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-reads'));
    const grant = approved(list, c);
    let reads = 0;
    const read = list.env.sheet.read.bind(list.env.sheet);
    list.env.sheet.read = (tab) => {
      reads++;
      return read(tab);
    };
    for (let i = 0; i < 4; i++) {
      list.move(6 * SECOND);
      c.check(grant);
    }
    // Two tabs, read at 6 s and again at 18 s (the read from 6 s is 12 s old by then).
    expect(reads).toBe(4);
  });
});

describe('the owner', () => {
  function setUp() {
    const list = newList();
    const owner = new Computer(list, placeholderComputer('mac-owner-ops'));
    const me = ownerIn(list, owner);
    return { list, owner, me };
  }

  it('is the only one who may call the owner’s calls (not-owner for anyone else)', () => {
    const { list, owner, me } = setUp();
    const c = new Computer(list, placeholderComputer('mac-not-owner'));
    const grant = approved(list, c);
    for (const op of ['list', 'add', 'approve', 'reject', 'revoke', 'regrant', 'note'])
      expect(c.owner(op, grant, { target: OTHER, note: 'x' })).toMatchObject({
        ok: false,
        error: 'not-owner',
      });
    expect(owner.owner('list', { ...me, secret: '1'.repeat(64) })).toMatchObject({
      ok: false,
      error: 'not-owner',
    });
    expect(new Computer(list, placeholderComputer('mac-owner-copy')).owner('list', me)).toMatchObject({
      ok: false,
      error: 'not-owner',
    });
  });

  it('lists every Gmail: status, dates, computers, totals, a token waiting and a request', () => {
    const { list, owner, me } = setUp();
    const c = new Computer(list, placeholderComputer('mac-listed', 'Placeholder Hall PC'));
    const grant = approved(list, c);
    list.move(MINUTE);
    c.check(grant, { minutes: 12, shows: 1, streams: 0, recordings: 0, imports: 2 });
    new Computer(list, placeholderComputer('mac-asking')).request(OTHER, 'Placeholder Other');
    const a = owner.owner('list', me);
    expect(a).toMatchObject({ ok: true });
    const people = a['people'] as Record<string, unknown>[];
    expect(people.map((p) => p['gmail'])).toEqual([PLACEHOLDER_APPROVER, PERSON, OTHER]);
    expect(people[0]).toMatchObject({ owner: true, status: 'approved' });
    expect(people[1]).toMatchObject({
      owner: false,
      status: 'approved',
      minutes: 12,
      shows: 1,
      imports: 2,
      version: '1.0.0-alpha.13',
      token: null,
      request: null,
      computers: [
        { name: 'Placeholder Hall PC', version: '1.0.0-alpha.13', platform: 'darwin', ended: false },
      ],
    });
    expect(people[2]).toMatchObject({
      status: 'requested',
      name: 'Placeholder Other',
      computers: [],
      request: { computer: 'Placeholder Mac (Drashti 1.0.0-alpha.13, Mac)' },
    });
  });

  it('adds a Gmail (a request, and the approver’s email), approves it, notes it', () => {
    const { list, owner, me } = setUp();
    expect(
      owner.owner('add', me, { target: PERSON, name: 'Placeholder Added', note: 'Hall team' }),
    ).toMatchObject({
      ok: true,
      status: 'requested',
      mailed: true,
    });
    expect(list.mailTo(PLACEHOLDER_APPROVER).at(-1)?.subject).toBe(`Drashti: ${PERSON} added`);
    expect(row(list, PERSON)).toMatchObject({
      Status: 'requested',
      Name: 'Placeholder Added',
      Note: 'Hall team',
    });
    expect(owner.owner('approve', me, { target: PERSON })).toMatchObject({ ok: true, status: 'approved' });
    expect(list.tokenFor(PERSON)).not.toBeNull();
    expect(owner.owner('approve', me, { target: PERSON })).toMatchObject({
      ok: false,
      error: 'already-approved',
    });
    expect(owner.owner('add', me, { target: PERSON })).toMatchObject({
      ok: false,
      error: 'already-approved',
    });
    expect(owner.owner('note', me, { target: PERSON, note: '=Placeholder note' })).toMatchObject({
      ok: true,
    });
    expect(row(list, PERSON)?.['Note']).toBe('Placeholder note');
    for (const op of ['approve', 'regrant', 'reject', 'revoke', 'note'])
      expect(owner.owner(op, me, { target: OTHER, note: 'x' })).toMatchObject({
        ok: false,
        error: 'not-found',
      });
  });

  it('rejects a request; never one that is approved, and never the owner’s own row', () => {
    const { list, owner, me } = setUp();
    owner.owner('add', me, { target: PERSON });
    expect(owner.owner('reject', me, { target: PERSON })).toMatchObject({
      ok: true,
      status: 'rejected',
      mailed: true,
    });
    expect(row(list, PERSON)?.['Status']).toBe('rejected');
    expect(owner.owner('reject', me, { target: PERSON })).toMatchObject({ ok: false, error: 'wrong-status' });
    expect(owner.owner('reject', me, { target: PLACEHOLDER_APPROVER })).toMatchObject({
      ok: false,
      error: 'owner-row',
    });
    expect(owner.owner('revoke', me, { target: PLACEHOLDER_APPROVER })).toMatchObject({
      ok: false,
      error: 'owner-row',
    });
    expect(owner.check(me)).toMatchObject({ status: 'in', owner: true });
  });

  it('revokes every computer of a Gmail at once; gives access again with a new token and no computer in', () => {
    const { list, owner, me } = setUp();
    const a = new Computer(list, placeholderComputer('mac-rv-a'));
    const b = new Computer(list, placeholderComputer('mac-rv-b'));
    const ga = approved(list, a);
    owner.owner('regrant', me, { target: PERSON });
    const gb = b.letIn(PERSON, list.tokenFor(PERSON) ?? '');
    owner.owner('regrant', me, { target: PERSON });
    const unused = list.tokenFor(PERSON) ?? '';
    expect(owner.owner('revoke', me, { target: PERSON })).toMatchObject({ ok: true, status: 'revoked' });
    expect(owner.owner('revoke', me, { target: PERSON })).toMatchObject({ ok: false, error: 'wrong-status' });
    list.move(6 * SECOND);
    expect(a.check(ga)).toMatchObject({ status: 'revoked' });
    expect(b.check(gb)).toMatchObject({ status: 'revoked' });
    expect(new Computer(list, placeholderComputer('mac-rv-c')).redeem(PERSON, unused)).toMatchObject({
      error: 'bad-token',
    });
    expect(owner.owner('regrant', me, { target: PERSON })).toMatchObject({ ok: true, status: 'approved' });
    expect(row(list, PERSON)).toMatchObject({ Status: 'approved', Computers: '' });
    list.move(6 * SECOND);
    expect(a.check(ga)).toMatchObject({ status: 'revoked' });
    const again = a.letIn(PERSON, list.tokenFor(PERSON) ?? '');
    list.move(6 * SECOND);
    expect(a.check(again)).toMatchObject({ status: 'in' });
  });

  it('changes nothing when the email cannot go: the day’s emails used up, or the email failing', () => {
    const { list, owner, me } = setUp();
    owner.owner('add', me, { target: PERSON });
    list.mailQuota = list.mailbox.length;
    expect(owner.owner('approve', me, { target: PERSON })).toMatchObject({ ok: false, error: 'mail-limit' });
    expect(row(list, PERSON)?.['Status']).toBe('requested');
    list.mailQuota = 100;
    list.failNextMail = true;
    expect(owner.owner('approve', me, { target: PERSON })).toMatchObject({ ok: false, error: 'mail-failed' });
    expect(row(list, PERSON)?.['Status']).toBe('requested');
    expect(list.sheet.records(COMPUTERS).filter((r) => r['Gmail'] === PERSON)).toHaveLength(0);
    expect(owner.owner('approve', me, { target: PERSON })).toMatchObject({ ok: true });
  });

  it('a failed email for a new token leaves the token sent before working', () => {
    const { list, owner, me } = setUp();
    owner.owner('add', me, { target: PERSON });
    owner.owner('approve', me, { target: PERSON });
    const first = list.tokenFor(PERSON) ?? '';
    list.failNextMail = true;
    expect(owner.owner('regrant', me, { target: PERSON })).toMatchObject({ ok: false, error: 'mail-failed' });
    expect(new Computer(list, placeholderComputer('mac-first-token')).redeem(PERSON, first)).toMatchObject({
      ok: true,
    });
  });
});

describe('the owner’s first way in (Let me in)', () => {
  it('makes the owner’s row approved and emails a token to the approver’s own address', () => {
    const list = newList();
    expect(core.letOwnerIn(list.env)).toMatchObject({ ok: true, to: PLACEHOLDER_APPROVER });
    expect(row(list, PLACEHOLDER_APPROVER)).toMatchObject({ Status: 'approved', Name: 'Owner' });
    const c = new Computer(list, placeholderComputer('mac-first-owner'));
    const a = c.redeem(PLACEHOLDER_APPROVER, list.tokenFor(PLACEHOLDER_APPROVER) ?? '');
    expect(a).toMatchObject({ ok: true, owner: true });
  });

  it('again: a new token, the unused one ended, the owner’s computers already in kept in', () => {
    const list = newList();
    const c = new Computer(list, placeholderComputer('mac-owner-again'));
    const grant = ownerIn(list, c);
    core.letOwnerIn(list.env);
    const unused = list.tokenFor(PLACEHOLDER_APPROVER) ?? '';
    core.letOwnerIn(list.env);
    expect(
      new Computer(list, placeholderComputer('mac-x')).redeem(PLACEHOLDER_APPROVER, unused),
    ).toMatchObject({
      error: 'bad-token',
    });
    list.move(6 * SECOND);
    expect(c.check(grant)).toMatchObject({ status: 'in', owner: true });
    expect(list.sheet.records(PEOPLE)).toHaveLength(1);
  });

  it('refuses before the list is set up', () => {
    const list = newList();
    list.props.secretKey = '';
    expect(() => core.letOwnerIn(list.env)).toThrow();
  });
});
