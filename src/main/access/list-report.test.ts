import { createHash, createHmac, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  callBody,
  core,
  linkParams,
  makeTestKeys,
  PEOPLE,
  PLACEHOLDER_APPROVER,
  placeholderComputer,
  readAnswer,
  TestList,
  type AnswerPayload,
  type SentMail,
  type TestKeys,
} from '../../../tests/access-core';
import {
  ACCESS_MAC_PREFIX,
  ACCESS_REPORT,
  canonicalJson,
  NO_ACTIVITY,
  type AccessComputer,
  type AccessGrant,
} from '../../shared/access-protocol';

/*
 * Help › Report a Problem… (x49, the owner's Q60-38 and his "Yes, all A" to Q60-42): the access list's `report` call,
 * run in access-list/core.js with the Sheet, the mailbox and the clock in memory (tests/access-core.ts). A report is
 * taken only from a computer let in now, signed as a check is, over the call without its files' data (each file bound
 * by its SHA-256); it emails the admin (the approver Gmail) with the files attached and Reply-To the person, and the
 * person a short "received" note; never twice for one report; at most 5 a day from a computer and 20 in all, and none
 * once fewer than 30 of the day's emails would be left. Placeholder addresses, computers, words and files only.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

const PERSON = 'placeholder.user@example.com';

let keys: TestKeys;
beforeAll(() => {
  keys = makeTestKeys();
});

const newList = (o: { mailQuota?: number } = {}) => new TestList({ keys, ...o });

interface FileIn {
  kind: 'diagnostics' | 'picture' | 'crash';
  name: string;
  type: string;
  bytes: Buffer;
}

interface FeatureIn {
  chapter: string;
  name: string;
  what: string;
  expected?: string;
}

interface ReportIn {
  id?: string;
  written?: number;
  from?: string;
  node?: AccessComputer;
  features: FeatureIn[];
  notice?: string;
  errors?: string[];
  kept?: { name: string; bytes: number }[];
}

interface Tamper {
  /** Each file as the call says it, before the mac is made (a lie the mac covers). */
  files?: (files: Record<string, unknown>[]) => Record<string, unknown>[];
  /** The call after its mac is made (a change the mac does not cover, but for `data`). */
  after?: (body: Record<string, unknown>) => void;
  /** The files' data as sent. */
  data?: (data: Record<string, string>) => Record<string, string>;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const DIAGNOSTICS: FileIn = {
  kind: 'diagnostics',
  name: 'Drashti diagnostics 2026-10-27 10-00.txt',
  type: 'text/plain',
  bytes: Buffer.from('== Drashti diagnostics ==\nPlaceholder diagnostics line\n', 'utf8'),
};
const PICTURE: FileIn = {
  kind: 'picture',
  name: 'Drashti window 2026-10-27 10-00.png',
  type: 'image/png',
  bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 7)]),
};
const crash = (n: number, size = 64): FileIn => ({
  kind: 'crash',
  name: `0f1e2d3c-placeholder-${String(n)}.dmp`,
  type: 'application/octet-stream',
  bytes: Buffer.concat([Buffer.from('MDMP'), Buffer.alloc(Math.max(0, size - 4), n)]),
});

const TWO: FeatureIn[] = [
  {
    chapter: 'LIVE, Back and Next',
    name: 'The time bar',
    what: 'Placeholder words:\nthe time bar stops.',
    expected: 'Placeholder: it runs on.',
  },
  { chapter: 'LIVE, Back and Next', name: 'Markers', what: 'Placeholder: a marker is lost.' },
];

/** A placeholder computer calling the list, every answer's signature, op, nonce and computer id checked. */
class Reporter {
  at = Date.UTC(2026, 9, 27, 10, 0, 0);

  constructor(
    readonly list: TestList,
    readonly computer: AccessComputer,
  ) {}

  call(op: string, fields: Record<string, unknown>, grant?: AccessGrant): AnswerPayload {
    const { body, nonce } = callBody(op, this.computer, fields, grant);
    const answer = readAnswer(this.list.handle(JSON.stringify(body)), this.list.keys.publicKey);
    expect(answer).toMatchObject({ v: 1, op, nonce, computerId: this.computer.id });
    return answer;
  }

  check(grant: AccessGrant): AnswerPayload {
    this.at += SECOND;
    return this.call('check', { at: this.at, activity: NO_ACTIVITY }, grant);
  }

  /** The call as Drashti sends it: signed as a check is, over the call without `data`. */
  body(grant: AccessGrant, report: ReportIn, files: FileIn[], t: Tamper = {}): Record<string, unknown> {
    this.at += SECOND;
    const meta = files.map((f) => ({
      kind: f.kind,
      name: f.name,
      type: f.type,
      bytes: f.bytes.length,
      sha256: sha(f.bytes),
    }));
    const body: Record<string, unknown> = {
      v: 1,
      op: 'report',
      nonce: randomBytes(16).toString('hex'),
      computer: this.computer,
      gmail: grant.gmail,
      grantId: grant.grantId,
      at: this.at,
      report: {
        id: report.id ?? randomBytes(16).toString('hex'),
        written: report.written ?? this.list.t,
        from: report.from ?? 'pro',
        ...(report.node === undefined ? {} : { node: report.node }),
        features: report.features.map((f) => ({ ...f })),
        ...(report.notice === undefined ? {} : { notice: report.notice }),
        ...(report.errors === undefined ? {} : { errors: report.errors }),
        ...(report.kept === undefined ? {} : { kept: report.kept }),
        files: t.files ? t.files(meta) : meta,
      },
    };
    body['mac'] = createHmac('sha256', Buffer.from(grant.secret, 'utf8'))
      .update(`${ACCESS_MAC_PREFIX}${canonicalJson(body)}`, 'utf8')
      .digest('hex');
    const data = Object.fromEntries(files.map((f) => [sha(f.bytes), f.bytes.toString('base64')]));
    body['data'] = t.data ? t.data(data) : data;
    t.after?.(body);
    return body;
  }

  report(grant: AccessGrant, report: ReportIn, files: FileIn[] = [], t: Tamper = {}): AnswerPayload {
    const body = this.body(grant, report, files, t);
    const answer = readAnswer(this.list.handle(JSON.stringify(body)), this.list.keys.publicKey);
    expect(answer).toMatchObject({
      v: 1,
      op: 'report',
      nonce: body['nonce'],
      computerId: this.computer.id,
      serverTime: this.list.t,
    });
    return answer;
  }
}

/** Ask, approve by the link in the approver's email (with a length, if given), and come in with the token. */
function approved(list: TestList, c: Reporter, gmail = PERSON, length?: string): AccessGrant {
  expect(c.call('request', { gmail, name: 'Placeholder Person' })).toMatchObject({ ok: true });
  const links = list.linksFor(gmail);
  if (!links) throw new Error('No links');
  expect(
    core.answerLink(list.env, { ...linkParams(links.approve), ...(length ? { length } : {}) }),
  ).toMatchObject({ kind: 'done' });
  const token = list.tokenFor(gmail);
  if (!token) throw new Error('No token');
  const a = c.call('redeem', { gmail, token });
  expect(a).toMatchObject({ ok: true });
  return { gmail, grantId: String(a['grantId']), secret: String(a['secret']) };
}

/** The owner let in through Let me in (the owner) on the Sheet's menu. */
function ownerIn(list: TestList, c: Reporter): AccessGrant {
  core.letOwnerIn(list.env);
  const token = list.tokenFor(PLACEHOLDER_APPROVER);
  if (!token) throw new Error('No token');
  const a = c.call('redeem', { gmail: PLACEHOLDER_APPROVER, token });
  return { gmail: PLACEHOLDER_APPROVER, grantId: String(a['grantId']), secret: String(a['secret']) };
}

const reporter = (list: TestList, n: string, name = 'Placeholder Mac') =>
  new Reporter(list, placeholderComputer(`report-${n}`, name));

const mailsAfter = (list: TestList, n: number): SentMail[] => list.mailbox.slice(n);

describe('a report’s reference', () => {
  it('is "R-" and the id’s first 40 bits in Crockford’s base32 letters, in two fours', () => {
    expect(core.reportReference('0'.repeat(32))).toBe('R-0000-0000');
    expect(core.reportReference('f'.repeat(32))).toBe('R-ZZZZ-ZZZZ');
    expect(core.reportReference(`0842108421${'0'.repeat(22)}`)).toBe('R-1111-1111');
    expect(core.reportReference(randomBytes(16).toString('hex'))).toMatch(
      /^R-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u,
    );
  });
});

describe('a report from a computer let in', () => {
  it('emails the admin (the approver Gmail) from Drashti, Reply-To the person: the features in the subject, every word, the computer and the files; the person a short note; answered received, signed', () => {
    const list = newList();
    const c = reporter(list, 'mac');
    const grant = approved(list, c);
    const before = list.mailbox.length;
    const id = randomBytes(16).toString('hex');
    const reference = core.reportReference(id);
    const a = c.report(
      grant,
      {
        id,
        features: TWO,
        notice: 'Placeholder notice words.',
        errors: ['2026-10-27T09:59:00.000Z [error] Placeholder error line'],
      },
      [DIAGNOSTICS, PICTURE],
    );
    expect(a).toMatchObject({ ok: true, received: true, again: false, reference });
    const mails = mailsAfter(list, before);
    expect(mails).toHaveLength(2);
    const [admin, note] = mails;
    expect(admin).toMatchObject({
      to: PLACEHOLDER_APPROVER,
      name: 'Drashti',
      replyTo: PERSON,
      subject: `Drashti problem: The time bar, Markers (${reference})`,
    });
    expect(admin?.body).toBe(
      [
        `Drashti problem ${reference}`,
        '',
        `From: ${PERSON} (the Gmail let in on that computer)`,
        'Computer: Placeholder Mac (Drashti 1.0.0-alpha.13, Mac), in Pro Mode',
        'Written: 2026-10-27 10:00 UTC (by that computer’s clock); received 2026-10-27 10:00 UTC',
        '',
        '1. The time bar (LIVE, Back and Next)',
        'What went wrong:',
        'Placeholder words:',
        'the time bar stops.',
        'What they expected:',
        'Placeholder: it runs on.',
        '',
        '2. Markers (LIVE, Back and Next)',
        'What went wrong:',
        'Placeholder: a marker is lost.',
        '',
        'The notice Drashti showed: “Placeholder notice words.”',
        '',
        'Recent errors in its log:',
        '  2026-10-27T09:59:00.000Z [error] Placeholder error line',
        '',
        `Attached: ${DIAGNOSTICS.name} (${String(DIAGNOSTICS.bytes.length)} bytes); ${PICTURE.name} (${String(PICTURE.bytes.length)} bytes)`,
        '',
        'Reply to this email to answer them.',
      ].join('\n'),
    );
    expect(admin?.attachments).toEqual([
      { name: DIAGNOSTICS.name, type: 'text/plain', base64: DIAGNOSTICS.bytes.toString('base64') },
      { name: PICTURE.name, type: 'image/png', base64: PICTURE.bytes.toString('base64') },
    ]);
    expect(note).toMatchObject({ to: PERSON, name: 'Drashti', subject: `Your Drashti report ${reference}` });
    expect(note?.body).toBe(
      [
        `Your report about The time bar and Markers reached the admin of Drashti on 2026-10-27 10:00 UTC (reference ${reference}). Thank you.`,
        '',
        'They may reply to this email.',
      ].join('\n'),
    );
    expect(note?.attachments ?? []).toEqual([]);
    expect(note?.replyTo).toBeUndefined();
  });

  it('says Simple Mode, a node through its Main (Q60-42: a node hands its report to Main), or Something else, as it came', () => {
    const list = newList();
    const c = reporter(list, 'simple');
    const grant = approved(list, c);
    let before = list.mailbox.length;
    c.report(grant, {
      from: 'simple',
      features: [{ chapter: '', name: 'Something else', what: 'Placeholder words.' }],
    });
    const simple = mailsAfter(list, before)[0];
    expect(simple?.subject).toMatch(/^Drashti problem: Something else \(R-/u);
    expect(simple?.body).toContain('Computer: Placeholder Mac (Drashti 1.0.0-alpha.13, Mac), in Simple Mode');
    expect(simple?.body).toContain('\n1. Something else\nWhat went wrong:\nPlaceholder words.\n');
    before = list.mailbox.length;
    const node: AccessComputer = {
      id: '0'.repeat(64),
      name: 'Placeholder Node',
      version: '1.0.0-alpha.13',
      platform: 'win32',
    };
    c.report(grant, { from: 'node', node, features: TWO });
    expect(mailsAfter(list, before)[0]?.body).toContain(
      'Computer: the node Placeholder Node (Drashti 1.0.0-alpha.13, Windows), through Main Placeholder Mac (Drashti 1.0.0-alpha.13, Mac)',
    );
    // A node's report names its node; nothing else does.
    expect(c.report(grant, { from: 'node', features: TWO })).toMatchObject({
      ok: false,
      error: 'bad-request',
    });
    expect(c.report(grant, { from: 'pro', node, features: TWO })).toMatchObject({
      ok: false,
      error: 'bad-request',
    });
    expect(c.report(grant, { from: 'phone', features: TWO })).toMatchObject({
      ok: false,
      error: 'bad-request',
    });
  });

  it('from the owner’s own computer: no note to himself, no Reply-To, no reply line', () => {
    const list = newList();
    const c = reporter(list, 'owner');
    const grant = ownerIn(list, c);
    const before = list.mailbox.length;
    expect(c.report(grant, { features: TWO })).toMatchObject({ ok: true, received: true });
    const mails = mailsAfter(list, before);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(PLACEHOLDER_APPROVER);
    expect(mails[0]?.replyTo).toBeUndefined();
    expect(mails[0]?.body).toContain(`From: ${PLACEHOLDER_APPROVER} (the Gmail let in on that computer)`);
    expect(mails[0]?.body).not.toContain('Reply to this email');
  });

  it('names at most three features in the subject, then how many more, in 160 letters at most', () => {
    const list = newList();
    const c = reporter(list, 'many');
    const grant = approved(list, c);
    const names = ['The time bar', 'Markers', 'Oops', 'Next and Back', 'Black-out and the Wallpaper'];
    const before = list.mailbox.length;
    const a = c.report(grant, {
      features: names.map((name) => ({ chapter: 'LIVE, Back and Next', name, what: 'Placeholder.' })),
    });
    const subject = mailsAfter(list, before)[0]?.subject ?? '';
    expect(subject).toBe(
      `Drashti problem: The time bar, Markers, Oops and 2 more (${String(a['reference'])})`,
    );
    const long = 'Placeholder feature with a long name '.repeat(3).trim();
    const b = list.mailbox.length;
    c.report(grant, {
      features: [1, 2, 3].map((n) => ({ chapter: '', name: `${long} ${String(n)}`, what: 'Placeholder.' })),
    });
    const cut = mailsAfter(list, b)[0]?.subject ?? '';
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut).toMatch(/ and 2 more \(R-[0-9A-Z]{4}-[0-9A-Z]{4}\)$/u);
  });
});

describe('a report is taken only from a computer let in now', () => {
  it('refuses not-in, emailing and counting nothing: a forged mac, another computer, another Gmail, a grant not known', () => {
    const list = newList();
    const c = reporter(list, 'in');
    const grant = approved(list, c);
    const other = reporter(list, 'other');
    const before = list.mailbox.length;
    const refused = [
      c.report(grant, { features: TWO }, [], {
        after: (b) => {
          const [first] = (b['report'] as { features: FeatureIn[] }).features;
          if (first) first.what = 'Changed on the way.';
        },
      }),
      other.report(grant, { features: TWO }),
      c.report({ ...grant, gmail: 'placeholder.other@example.com' }, { features: TWO }),
      c.report({ ...grant, grantId: 'a'.repeat(32) }, { features: TWO }),
      c.report({ ...grant, secret: 'b'.repeat(64) }, { features: TWO }),
    ];
    for (const a of refused) expect(a).toMatchObject({ ok: false, error: 'not-in' });
    expect(list.mailbox.length).toBe(before);
    expect(list.properties.has('REPORTS_TODAY')).toBe(false);
  });

  it('refuses not-in once the Gmail is revoked or rejected in the Sheet, its length has ended, or after 15 days with no check', () => {
    for (const how of ['revoked', 'rejected', 'ended', 'quiet'] as const) {
      const list = newList();
      const c = reporter(list, how);
      const grant = approved(list, c, PERSON, how === 'ended' ? '1' : undefined);
      expect(c.report(grant, { features: TWO }), how).toMatchObject({ ok: true });
      const before = list.mailbox.length;
      if (how === 'revoked' || how === 'rejected') list.sheet.type(PEOPLE, 'Gmail', PERSON, 'Status', how);
      if (how === 'ended') {
        list.move(DAY + HOUR);
        expect(c.check(grant)).toMatchObject({ status: 'expired' });
      }
      if (how === 'quiet') list.move(16 * DAY);
      expect(c.report(grant, { features: TWO }), how).toMatchObject({ ok: false, error: 'not-in' });
      expect(list.mailbox.length, how).toBe(before);
    }
  });
});

describe('a report’s files', () => {
  it('are checked against their data: a changed byte, a missing or extra entry, a size that is not the file’s, data that is not base64: bad-request, nothing emailed', () => {
    const list = newList();
    const c = reporter(list, 'files');
    const grant = approved(list, c);
    const before = list.mailbox.length;
    const key = sha(DIAGNOSTICS.bytes);
    const flipped = Buffer.from(DIAGNOSTICS.bytes);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const cases: Tamper[] = [
      { data: (d) => ({ ...d, [key]: flipped.toString('base64') }) },
      { data: (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)) },
      { data: (d) => ({ ...d, ['c'.repeat(64)]: 'AAAA' }) },
      {
        files: (f) =>
          f.map((x) => (x['kind'] === 'diagnostics' ? { ...x, bytes: Number(x['bytes']) + 1 } : x)),
      },
      { data: (d) => ({ ...d, [key]: '%%not base64%%' }) },
    ];
    for (const t of cases)
      expect(c.report(grant, { features: TWO }, [DIAGNOSTICS, PICTURE], t)).toMatchObject({
        ok: false,
        error: 'bad-request',
      });
    expect(list.mailbox.length).toBe(before);
  });

  it('are of three kinds, each with its own type and name: one diagnostics file, one picture, five crash files at most', () => {
    const list = newList();
    const c = reporter(list, 'kinds');
    const grant = approved(list, c);
    const before = list.mailbox.length;
    const bad: FileIn[][] = [
      [{ ...DIAGNOSTICS, type: 'image/png' }],
      [{ ...PICTURE, type: 'text/plain' }],
      [{ ...DIAGNOSTICS, name: '../Placeholder.txt' }],
      [{ ...PICTURE, name: 'Drashti window 2026-10-27 10-00.html' }],
      [{ ...crash(1), name: 'placeholder.exe' }],
      [{ ...DIAGNOSTICS, kind: 'library' as FileIn['kind'] }],
      [DIAGNOSTICS, { ...DIAGNOSTICS, bytes: Buffer.from('Placeholder second\n') }],
      [PICTURE, { ...PICTURE, bytes: Buffer.alloc(40, 9) }],
      [1, 2, 3, 4, 5, 6].map((n) => crash(n)),
    ];
    for (const files of bad)
      expect(c.report(grant, { features: TWO }, files)).toMatchObject({ ok: false, error: 'bad-request' });
    expect(list.mailbox.length).toBe(before);
    expect(
      c.report(grant, { features: TWO }, [DIAGNOSTICS, PICTURE, ...[1, 2, 3, 4, 5].map((n) => crash(n))]),
    ).toMatchObject({ ok: true });
  });

  it('weigh 7 MB at most in all (Q60-42), or the report is too-large; crash files kept back are named in the email', () => {
    const list = newList();
    const c = reporter(list, 'large');
    const grant = approved(list, c);
    expect(ACCESS_REPORT.filesBytes).toBe(7 * MB);
    const before = list.mailbox.length;
    const big = [crash(1, 3 * MB), crash(2, 3 * MB), crash(3, MB + 1)];
    expect(c.report(grant, { features: TWO }, big)).toMatchObject({ ok: false, error: 'too-large' });
    expect(list.mailbox.length).toBe(before);
    const fits = [crash(1, 3 * MB), crash(2, 3 * MB), crash(3, MB)];
    expect(
      c.report(grant, { features: TWO, kept: [{ name: '0f1e2d3c-placeholder-9.dmp', bytes: 4 * MB }] }, fits),
    ).toMatchObject({ ok: true });
    const admin = mailsAfter(list, before)[0];
    expect(admin?.attachments).toHaveLength(3);
    expect(admin?.body).toContain(
      'Kept on their computer (too large to send): 0f1e2d3c-placeholder-9.dmp (4.0 MB)',
    );
  });

  it('a call longer than the list reads (10 MB of text) is refused too-large, unread', () => {
    const list = newList();
    const answer = list.handle(`{"v":1,"op":"report","pad":"${'x'.repeat(ACCESS_REPORT.textChars)}"}`);
    expect(readAnswer(answer, keys.publicKey)).toMatchObject({ ok: false, error: 'too-large' });
  });
});

describe('a report’s words', () => {
  it('take 1 to 8 features (Q60-42), each with what went wrong (2,000 letters) and what they expected (1,000)', () => {
    const list = newList();
    const c = reporter(list, 'words');
    const grant = approved(list, c);
    const one = (what: string, expected?: string): FeatureIn[] => [
      { chapter: 'Stream', name: 'Going live', what, ...(expected === undefined ? {} : { expected }) },
    ];
    const ok = c.report(grant, { features: one('ક'.repeat(2000), 'ખ'.repeat(1000)) });
    expect(ok).toMatchObject({ ok: true });
    const nine = Array.from({ length: 9 }, (_, i) => ({
      chapter: '',
      name: `Placeholder ${String(i)}`,
      what: 'x',
    }));
    for (const features of [
      [],
      nine,
      one(''),
      one('   \n  '),
      one('x'.repeat(2001)),
      one('x', 'y'.repeat(1001)),
      [{ chapter: '', name: '', what: 'x' }],
    ])
      expect(c.report(grant, { features })).toMatchObject({ ok: false, error: 'bad-request' });
    const eight = Array.from({ length: 8 }, (_, i) => ({
      chapter: '',
      name: `Placeholder ${String(i)}`,
      what: 'x',
    }));
    expect(c.report(grant, { features: eight })).toMatchObject({ ok: true });
  });

  it('are cleaned as the list cleans what people type, their line breaks kept: hidden and control characters out', () => {
    const list = newList();
    const c = reporter(list, 'clean');
    const grant = approved(list, c);
    const before = list.mailbox.length;
    c.report(grant, {
      features: [
        {
          chapter: 'Stream',
          name: 'Going‮ live',
          what: '  Placeholder\u0007 words\r\n\r\n\r\n\r\nsecond​ line\t\there  \n',
        },
      ],
      notice: 'Placeholder\nnotice',
    });
    const body = mailsAfter(list, before)[0]?.body ?? '';
    expect(body).toContain(
      '\n1. Going live (Stream)\nWhat went wrong:\nPlaceholder words\n\nsecond line here\n',
    );
    expect(body).toContain('The notice Drashti showed: “Placeholder notice”');
    expect(core.cleanLines(' a\u0000b \r\nc d ')).toBe('a b\nc d');
  });

  it('carry 30 recent error lines at most, each 300 letters at most, and a notice of 500', () => {
    const list = newList();
    const c = reporter(list, 'errors');
    const grant = approved(list, c);
    const lines = (n: number, size = 20) => Array.from({ length: n }, () => 'e'.repeat(size));
    expect(c.report(grant, { features: TWO, errors: lines(30, 300), notice: 'n'.repeat(500) })).toMatchObject(
      {
        ok: true,
      },
    );
    for (const r of [
      { errors: lines(31) },
      { errors: lines(1, 301) },
      { notice: 'n'.repeat(501) },
      { errors: ['ok', 5] as unknown as string[] },
    ])
      expect(c.report(grant, { features: TWO, ...r })).toMatchObject({ ok: false, error: 'bad-request' });
  });
});

describe('a report is never emailed twice, and never floods the admin’s mail (Q60-42)', () => {
  it('the same report again is answered received, again, with its reference: nothing emailed, nothing counted', () => {
    const list = newList();
    const c = reporter(list, 'twice');
    const grant = approved(list, c);
    const id = randomBytes(16).toString('hex');
    const before = list.mailbox.length;
    expect(c.report(grant, { id, features: TWO })).toMatchObject({ ok: true, again: false });
    expect(list.mailbox.length).toBe(before + 2);
    const counted = list.properties.get('REPORTS_TODAY');
    const again = c.report(grant, { id, features: TWO });
    expect(again).toMatchObject({
      ok: true,
      received: true,
      again: true,
      reference: core.reportReference(id),
    });
    expect(list.mailbox.length).toBe(before + 2);
    expect(list.properties.get('REPORTS_TODAY')).toBe(counted);
    // Two days later the id is forgotten (a report is never tried that long after it was received).
    list.move(2 * DAY + MINUTE);
    c.check(grant);
    expect(c.report(grant, { id, features: TWO })).toMatchObject({ ok: true, again: false });
  });

  it('takes 5 a day from one computer and 20 in all, then too-many, nothing emailed; a new day by the list’s clock starts again', () => {
    const list = newList();
    const people = Array.from({ length: 5 }, (_, i) => {
      const c = reporter(list, `day-${String(i)}`, `Placeholder Mac ${String(i)}`);
      return { c, grant: approved(list, c, `placeholder.p${String(i)}@example.com`) };
    });
    const [first, ...rest] = people;
    if (!first) throw new Error('No computers');
    for (let n = 0; n < ACCESS_REPORT.perComputerPerDay; n++)
      expect(first.c.report(first.grant, { features: TWO })).toMatchObject({ ok: true });
    const before = list.mailbox.length;
    expect(first.c.report(first.grant, { features: TWO })).toMatchObject({ ok: false, error: 'too-many' });
    expect(list.mailbox.length).toBe(before);
    for (const p of rest.slice(0, 3))
      for (let n = 0; n < ACCESS_REPORT.perComputerPerDay; n++)
        expect(p.c.report(p.grant, { features: TWO })).toMatchObject({ ok: true });
    const last = rest[3];
    if (!last) throw new Error('No fifth computer');
    // 20 in all today: the fifth computer's first is refused.
    expect(last.c.report(last.grant, { features: TWO })).toMatchObject({ ok: false, error: 'too-many' });
    const day = Math.floor(list.t / DAY);
    list.move((day + 1) * DAY - list.t + MINUTE);
    for (const p of people) p.c.check(p.grant);
    expect(last.c.report(last.grant, { features: TWO })).toMatchObject({ ok: true });
    expect(first.c.report(first.grant, { features: TWO })).toMatchObject({ ok: true });
  });

  it('takes none once fewer than 30 of the day’s emails would be left (mail-limit), so a token still goes', () => {
    const list = newList({ mailQuota: 36 });
    const c = reporter(list, 'reserve');
    const grant = approved(list, c);
    // 34 left: a report takes two, leaving 32; then 30; the next would leave 28.
    expect(c.report(grant, { features: TWO })).toMatchObject({ ok: true });
    expect(c.report(grant, { features: TWO })).toMatchObject({ ok: true });
    const before = list.mailbox.length;
    expect(c.report(grant, { features: TWO })).toMatchObject({ ok: false, error: 'mail-limit' });
    expect(list.mailbox.length).toBe(before);
    const other = reporter(list, 'reserve-2');
    expect(other.call('request', { gmail: 'placeholder.other@example.com' })).toMatchObject({
      ok: true,
      mailed: true,
    });
  });

  it('a failed email is mail-failed: the report counted all the same (a stuck Drashti cannot loop the admin’s mail), and its next try may go', () => {
    const list = newList();
    const c = reporter(list, 'fail');
    const grant = approved(list, c);
    const id = randomBytes(16).toString('hex');
    list.failNextMail = true;
    const before = list.mailbox.length;
    expect(c.report(grant, { id, features: TWO })).toMatchObject({ ok: false, error: 'mail-failed' });
    expect(list.mailbox.length).toBe(before);
    expect(JSON.parse(list.properties.get('REPORTS_TODAY') ?? '{}')).toMatchObject({ n: 1 });
    expect(c.report(grant, { id, features: TWO })).toMatchObject({ ok: true, again: false });
    expect(JSON.parse(list.properties.get('REPORTS_TODAY') ?? '{}')).toMatchObject({ n: 2 });
    // The list's log says the mail failed, never to whom, nor the words.
    expect(list.logs.join('\n')).toContain('Mail to a Gmail failed');
    expect(list.logs.join('\n')).not.toMatch(/placeholder\.|owner\.placeholder|Placeholder words/u);
  });

  it('answers with nothing secret: no address, no words, no file', () => {
    const list = newList();
    const c = reporter(list, 'secret');
    const grant = approved(list, c);
    const body = c.body(grant, { features: TWO }, [DIAGNOSTICS]);
    const { payload } = list.handle(JSON.stringify(body));
    expect(payload).not.toContain(PLACEHOLDER_APPROVER);
    expect(payload).not.toContain(PERSON);
    expect(payload).not.toContain('Placeholder words');
    expect(payload).not.toContain(DIAGNOSTICS.bytes.toString('base64'));
  });
});
