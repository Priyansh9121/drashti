import { describe, expect, it } from 'vitest';
import { ACCESS_ERRORS, type AccessPerson } from './access-protocol';
import { endsBarShown, endsBarText, endsBarTitle, leftText } from './access';
import {
  accessListCsv,
  CSV_COLUMNS,
  csvTime,
  DEFAULT_SORT,
  editsFor,
  endsCell,
  formatDay,
  LENGTH_CHOICES,
  lengthWord,
  typedDays,
  formatMinutes,
  formatSeen,
  matchesSearch,
  ownerErrorText,
  REVOKE_QUESTION,
  shownPeople,
  sortPeople,
  statusCounts,
  statusDetail,
  statusTone,
  statusWord,
  updatedWords,
} from './access-list';

/*
 * View › Access List… (Session 54, E4): the rules the owner's window keeps, with placeholder Gmails only. Which
 * edits each row offers (never Revoke or Reject on the owner's own row), what Revoke asks first, sorting by any
 * column either way, the status filter and the search, the words, and the CSV the owner saves: the table's
 * columns and counts, never content.
 */

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
  length: null,
  endsAt: null,
  ended: false,
  endsUnreadable: false,
  computers: [],
  token: null,
  request: null,
  ...o,
});

const mac = (name: string, o: Partial<AccessPerson['computers'][number]> = {}) => ({
  name,
  version: '1.0.0-alpha.13',
  platform: 'darwin',
  lastSeen: null,
  usedAt: null,
  ended: false,
  endedWhy: '',
  ...o,
});

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const gmails = (people: readonly AccessPerson[]) => people.map((p) => p.gmail);

describe('the edits each Gmail is offered', () => {
  it('follow its status: a request Approve or Reject, approved Give access again, Change the length or Revoke, and a note for all', () => {
    expect(editsFor(person({ gmail: 'a@example.com', status: 'requested' }))).toEqual([
      'approve',
      'reject',
      'note',
    ]);
    expect(editsFor(person({ gmail: 'a@example.com', status: 'approved' }))).toEqual([
      'regrant',
      'length',
      'revoke',
      'note',
    ]);
    // Its length ended: Give access again, or a new length, brings it back.
    expect(editsFor(person({ gmail: 'a@example.com', status: 'approved', ended: true }))).toEqual([
      'regrant',
      'length',
      'revoke',
      'note',
    ]);
    expect(editsFor(person({ gmail: 'a@example.com', status: 'rejected' }))).toEqual(['approve', 'note']);
    expect(editsFor(person({ gmail: 'a@example.com', status: 'revoked' }))).toEqual(['regrant', 'note']);
    // A status typed into the Sheet that the list does not know stops that Gmail: Give access again puts it right.
    expect(editsFor(person({ gmail: 'a@example.com', status: 'paused' }))).toEqual(['regrant', 'note']);
    expect(editsFor(person({ gmail: 'a@example.com', status: '' }))).toEqual(['regrant', 'note']);
    // Typed in the Sheet in capitals or with spaces, a status is still the one it says.
    expect(editsFor(person({ gmail: 'a@example.com', status: ' Approved ' }))).toEqual([
      'regrant',
      'length',
      'revoke',
      'note',
    ]);
  });

  it('never offer Revoke, Reject or a length on the owner’s own row (always Unlimited)', () => {
    for (const status of ['requested', 'approved', 'rejected', 'revoked', 'paused']) {
      const edits = editsFor(person({ gmail: 'owner.placeholder@example.com', status, owner: true }));
      expect(edits, status).not.toContain('revoke');
      expect(edits, status).not.toContain('reject');
      expect(edits, status).not.toContain('length');
    }
    // The owner may still give their own Gmail access again, for another computer of theirs.
    expect(editsFor(person({ gmail: 'owner.placeholder@example.com', owner: true }))).toEqual([
      'regrant',
      'note',
    ]);
  });

  it('Revoke asks first, in the owner’s words', () => {
    expect(REVOKE_QUESTION.title('placeholder.user@example.com')).toBe(
      'Revoke placeholder.user@example.com?',
    );
    expect(REVOKE_QUESTION.body).toBe('Their Drashti stops at once, screens and stream included.');
  });

  it('say each refusal in words for the owner, never the list’s own or "something went wrong"', () => {
    for (const code of ACCESS_ERRORS) {
      const words = ownerErrorText(code);
      expect(words.length, code).toBeGreaterThan(20);
      expect(words.toLowerCase(), code).not.toContain('something went wrong');
    }
    // Where Drashti's words speak to a person asking for access, the owner is told what it means for them.
    expect(ownerErrorText('already-approved')).not.toContain('I Have a Token');
    expect(ownerErrorText('not-set-up')).toContain('Set up…');
  });
});

describe('sorting, the status filter and the search', () => {
  const people = [
    person({
      gmail: 'carol.placeholder@example.com',
      status: 'revoked',
      requestedAt: at(2026, 10, 1),
      revokedAt: at(2026, 10, 20),
      minutes: 30,
    }),
    person({
      gmail: 'alice.placeholder@example.com',
      name: 'Placeholder Alice',
      status: 'approved',
      requestedAt: at(2026, 10, 3),
      lastSeen: at(2026, 10, 27, 10),
      minutes: 600,
      shows: 4,
      computers: [mac('Placeholder Hall Mac')],
    }),
    person({ gmail: 'dave.placeholder@example.com', status: 'requested', requestedAt: at(2026, 10, 26) }),
    person({
      gmail: 'bob.placeholder@example.com',
      status: 'approved',
      requestedAt: at(2026, 10, 2),
      note: 'Placeholder note about the side room',
      shows: 12,
    }),
    person({ gmail: 'erin.placeholder@example.com', status: 'rejected' }),
    person({ gmail: 'frank.placeholder@example.com', status: 'paused' }),
    person({ gmail: 'abe.placeholder@example.com', status: 'requested', requestedAt: at(2026, 10, 25) }),
  ];

  it('opens by status, requests waiting first, then approved, revoked, rejected and any other, each by Gmail', () => {
    expect(gmails(sortPeople(people, DEFAULT_SORT))).toEqual([
      'abe.placeholder@example.com',
      'dave.placeholder@example.com',
      'alice.placeholder@example.com',
      'bob.placeholder@example.com',
      'carol.placeholder@example.com',
      'erin.placeholder@example.com',
      'frank.placeholder@example.com',
    ]);
  });

  it('sorts by any column, either way, with no date and no note always last', () => {
    expect(gmails(sortPeople(people, { column: 'requested', descending: false }))).toEqual([
      'carol.placeholder@example.com',
      'bob.placeholder@example.com',
      'alice.placeholder@example.com',
      'abe.placeholder@example.com',
      'dave.placeholder@example.com',
      'erin.placeholder@example.com',
      'frank.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'requested', descending: true }))).toEqual([
      'dave.placeholder@example.com',
      'abe.placeholder@example.com',
      'alice.placeholder@example.com',
      'bob.placeholder@example.com',
      'carol.placeholder@example.com',
      'erin.placeholder@example.com',
      'frank.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'shows', descending: true })).slice(0, 2)).toEqual([
      'bob.placeholder@example.com',
      'alice.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'minutes', descending: true })).slice(0, 2)).toEqual([
      'alice.placeholder@example.com',
      'carol.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'note', descending: true })).slice(0, 2)).toEqual([
      'bob.placeholder@example.com',
      'abe.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'gmail', descending: false })).slice(0, 3)).toEqual([
      'abe.placeholder@example.com',
      'alice.placeholder@example.com',
      'bob.placeholder@example.com',
    ]);
    expect(gmails(sortPeople(people, { column: 'computers', descending: true }))[0]).toBe(
      'alice.placeholder@example.com',
    );
    expect(gmails(sortPeople(people, { column: 'lastSeen', descending: false }))[0]).toBe(
      'alice.placeholder@example.com',
    );
    // The list it was given is left as it was.
    expect(people[0]?.gmail).toBe('carol.placeholder@example.com');
  });

  it('counts each status, and shows one status, or every Gmail, matching the search', () => {
    expect(statusCounts(people)).toEqual({ all: 7, requested: 2, approved: 2, revoked: 1, rejected: 1 });
    const shown = (status: Parameters<typeof shownPeople>[1]['status'], search = '') =>
      gmails(shownPeople(people, { status, search, sort: DEFAULT_SORT }));
    expect(shown('requested')).toEqual(['abe.placeholder@example.com', 'dave.placeholder@example.com']);
    expect(shown('rejected')).toEqual(['erin.placeholder@example.com']);
    expect(shown('all', 'PLACEHOLDER ALICE')).toEqual(['alice.placeholder@example.com']);
    expect(shown('approved', 'side room')).toEqual(['bob.placeholder@example.com']);
    expect(shown('requested', 'side room')).toEqual([]);
    expect(shown('all', 'nobody.here')).toEqual([]);
    expect(shown('all', '   ')).toHaveLength(7);
  });

  it('finds a Gmail by any word of its Gmail, name, status, note or a computer’s name or version', () => {
    const alice = people.find((p) => p.gmail === 'alice.placeholder@example.com');
    if (!alice) throw new Error('The placeholder Gmail is missing');
    expect(matchesSearch(alice, 'alice')).toBe(true);
    expect(matchesSearch(alice, 'hall mac')).toBe(true);
    expect(matchesSearch(alice, 'alpha.13')).toBe(true);
    expect(matchesSearch(alice, 'approved')).toBe(true);
    expect(matchesSearch(alice, 'alice revoked')).toBe(false);
    // Letters in either case, and in any of their Unicode forms.
    expect(matchesSearch(person({ gmail: 'x@example.com', name: 'Placeholder Ｇｏｐａｌ' }), 'gopal')).toBe(
      true,
    );
  });
});

describe('words', () => {
  it('says each status, and Other for one the list does not know', () => {
    expect(['requested', 'approved', 'revoked', 'rejected', 'paused', ''].map(statusWord)).toEqual([
      'Requested',
      'Approved',
      'Revoked',
      'Rejected',
      'Other',
      'No status',
    ]);
  });

  it('says under each status what the owner needs: where a request came from, a token waiting, a rejection’s day', () => {
    expect(
      statusDetail(
        person({
          gmail: 'a@example.com',
          status: 'requested',
          request: { computer: 'Placeholder Mac (Drashti 1.0.0-alpha.13, Mac)', at: null },
        }),
      ),
    ).toBe('Asked from Placeholder Mac (Drashti 1.0.0-alpha.13, Mac)');
    expect(
      statusDetail(
        person({
          gmail: 'a@example.com',
          status: 'requested',
          request: { computer: 'added by the owner', at: null },
        }),
      ),
    ).toBe('Added by you');
    expect(
      statusDetail(
        person({ gmail: 'a@example.com', token: { sentAt: at(2026, 10, 27), runsOut: at(2026, 10, 30, 9) } }),
      ),
    ).toBe('Token sent: runs out 30 Oct 2026');
    expect(statusDetail(person({ gmail: 'a@example.com' }))).toBe('No computer in yet');
    expect(statusDetail(person({ gmail: 'a@example.com', computers: [mac('Placeholder Mac')] }))).toBe('');
    expect(
      statusDetail(person({ gmail: 'a@example.com', status: 'rejected', rejectedAt: at(2026, 10, 4, 9) })),
    ).toBe('On 4 Oct 2026');
    expect(statusDetail(person({ gmail: 'a@example.com', status: 'paused' }))).toBe(
      '“paused” in the Sheet: their Drashti stops',
    );
    expect(['requested', 'approved', 'revoked', 'rejected', 'paused'].map(statusTone)).toEqual([
      'warning',
      'success',
      'danger',
      'neutral',
      'warning',
    ]);
  });

  it('says time used in minutes and hours', () => {
    expect([0, 1, 45, 60, 125, 6000, 7230].map(formatMinutes)).toEqual([
      'None',
      '1 min',
      '45 min',
      '1 h',
      '2 h 5 min',
      '100 h',
      '120 h',
    ]);
  });

  it('says when a Gmail was last seen, and when the list last answered, in words', () => {
    const now = at(2026, 10, 27, 12, 0);
    expect(formatSeen(null, now)).toBe('Never');
    expect(formatSeen(now - 30_000, now)).toBe('Just now');
    expect(formatSeen(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatSeen(at(2026, 10, 27, 9, 40), now)).toMatch(/^Today at /u);
    expect(formatSeen(at(2026, 10, 26, 18, 5), now)).toMatch(/^Yesterday at /u);
    expect(formatSeen(at(2026, 10, 20, 9), now)).toBe(formatDay(at(2026, 10, 20, 9)));
    expect(formatDay(at(2026, 10, 20, 9))).toBe('20 Oct 2026');
    expect(updatedWords(null, now)).toBe('Not updated yet');
    expect(updatedWords(now - 3_000, now)).toBe('Updated just now');
    expect(updatedWords(now - 40_000, now)).toBe('Updated less than a minute ago');
    expect(updatedWords(now - 3 * 60_000, now)).toBe('Updated 3 minutes ago');
    expect(updatedWords(now - 2 * 60 * 60_000, now)).toMatch(/^Updated at /u);
  });
});

/** A CSV's text read back: its rows, each its fields (RFC 4180's quotes undone). */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text.charAt(i + 1) === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}

describe('lengths of access (the owner’s decision of 28 Oct 2026)', () => {
  const DAY = 24 * 60 * 60_000;
  const now = at(2026, 10, 28, 12, 0);

  it('offers Unlimited first, then 1 day, 7 to 365 days; a typed number of days is a whole number from 1 to 730', () => {
    expect(LENGTH_CHOICES.map((c) => c.length)).toEqual(['unlimited', 1, 7, 30, 60, 90, 120, 180, 365]);
    expect(LENGTH_CHOICES[0]?.label).toBe('Unlimited, until you revoke it');
    expect(LENGTH_CHOICES[1]?.label).toBe('1 day (24 hours)');
    for (const [typed, days] of [
      ['45', 45],
      [' 730 ', 730],
      ['1', 1],
    ] as const)
      expect(typedDays(typed)).toBe(days);
    for (const typed of ['0', '731', '2.5', '-3', '', 'ten', '1e2', '0x10'])
      expect(typedDays(typed), typed).toBeNull();
    expect([lengthWord('unlimited'), lengthWord(1), lengthWord(30)]).toEqual([
      'Unlimited',
      '1 day',
      '30 days',
    ]);
  });

  it('says when each Gmail’s access ends, by the list’s time: Unlimited, a day and how long is left, ended, or not readable', () => {
    const ends = (o: Partial<AccessPerson>) => endsCell(person({ gmail: 'a@example.com', ...o }), now);
    expect(ends({ length: 'unlimited' })).toEqual({ text: 'Unlimited', detail: '', warn: false });
    expect(ends({ length: 30, endsAt: now + 30 * DAY })).toEqual({
      text: formatDay(now + 30 * DAY),
      detail: 'In 30 days',
      warn: false,
    });
    expect(ends({ length: 1, endsAt: now + 5 * 60 * 60_000 }).detail).toBe('In 5 hours');
    expect(ends({ length: 7, endsAt: now - DAY, ended: true })).toEqual({
      text: `Ended ${formatDay(now - DAY)}`,
      detail: 'Their Drashti has stopped',
      warn: true,
    });
    expect(ends({ ended: true, endsUnreadable: true })).toMatchObject({ text: 'Can’t be read', warn: true });
    expect(ends({ owner: true, endsAt: now - DAY })).toMatchObject({
      text: 'Unlimited',
      detail: 'Your own: always',
    });
    // A request the owner added with a length: that length once approved; any other status, nothing.
    expect(ends({ status: 'requested', length: 90 })).toMatchObject({
      text: '',
      detail: '90 days once approved',
    });
    expect(ends({ status: 'revoked', length: 30, endsAt: now + DAY })).toEqual({
      text: '',
      detail: '',
      warn: false,
    });
  });

  it('sorts by when access ends: one not readable first, then by the day, Unlimited after every day, the rest last', () => {
    const people = [
      person({ gmail: 'unlimited@example.com' }),
      person({ gmail: 'later@example.com', endsAt: now + 30 * DAY }),
      person({ gmail: 'asking@example.com', status: 'requested' }),
      person({ gmail: 'sooner@example.com', endsAt: now + DAY }),
      person({ gmail: 'unread@example.com', endsUnreadable: true, ended: true }),
    ];
    expect(sortPeople(people, { column: 'ends', descending: false }).map((p) => p.gmail)).toEqual([
      'unread@example.com',
      'sooner@example.com',
      'later@example.com',
      'unlimited@example.com',
      'asking@example.com',
    ]);
  });

  it('the window’s bar: from 7 days before the end, saying when and how long is left', () => {
    expect(endsBarShown(null)).toBe(false);
    expect(endsBarShown(7 * DAY + 1)).toBe(false);
    expect(endsBarShown(7 * DAY)).toBe(true);
    expect(endsBarShown(0)).toBe(true);
    expect([leftText(6 * DAY + 1), leftText(DAY - 1), leftText(61_000), leftText(59_000)]).toEqual([
      '6 days',
      '23 hours',
      '1 minute',
      'less than a minute',
    ]);
    expect(endsBarTitle(at(2026, 11, 4, 15, 40))).toMatch(/^Your access to Drashti ends on 4 Nov 2026 at /u);
    expect(endsBarText(3 * DAY)).toMatch(/^In 3 days\. Ask the person who approves access for more time/u);
  });
});

describe('the CSV the owner saves', () => {
  const people = [
    person({
      gmail: 'alice.placeholder@example.com',
      name: 'Placeholder, Alice "A"',
      status: 'approved',
      requestedAt: at(2026, 10, 3, 9, 5),
      approvedAt: at(2026, 10, 3, 18, 30),
      lastSeen: at(2026, 10, 27, 10, 0),
      minutes: 605,
      shows: 4,
      streams: 2,
      recordings: 1,
      imports: 9,
      note: 'Placeholder note\non two lines',
      length: 30,
      endsAt: at(2026, 11, 2, 18, 30),
      computers: [
        mac('Placeholder Old Mac', { ended: true, endedWhy: 'revoked' }),
        mac('Placeholder Hall Mac'),
        { ...mac('Placeholder PC'), platform: 'win32' },
      ],
    }),
    person({
      gmail: 'bob.placeholder@example.com',
      name: '=1+2',
      status: 'rejected',
      rejectedAt: at(2026, 10, 4),
    }),
  ];

  it('is the table’s columns with each date its own, a row for each Gmail, read as a spreadsheet reads it', () => {
    const text = accessListCsv(people);
    // A byte-order mark first, so names in any script open as written; every line ends CRLF.
    expect(text.startsWith('\uFEFFGmail,Name,Status,')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    const rows = readCsv(text.slice(1));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      'alice.placeholder@example.com',
      'Placeholder, Alice "A"',
      'Approved',
      '2026-10-03 09:05',
      '2026-10-03 18:30',
      '',
      '',
      '30 days',
      '2026-11-02 18:30',
      'Placeholder Hall Mac (Mac, 1.0.0-alpha.13); Placeholder PC (Windows, 1.0.0-alpha.13); Placeholder Old Mac (Mac, 1.0.0-alpha.13, ended: revoked)',
      '2026-10-27 10:00',
      '605',
      '4',
      '2',
      '1',
      '9',
      'Placeholder note\non two lines',
    ]);
    // Words someone typed that a spreadsheet would run as a formula are kept as words.
    expect(rows[2]?.slice(0, 3)).toEqual(['bob.placeholder@example.com', "'=1+2", 'Rejected']);
    expect(rows[2]?.[5]).toBe(csvTime(at(2026, 10, 4)));
    // Only an approved Gmail has an end: none, Unlimited, a date, or one typed in the Sheet that cannot be read.
    expect(rows[2]?.slice(7, 9)).toEqual(['', '']);
    const ends = (o: Partial<AccessPerson>) =>
      readCsv(accessListCsv([person({ gmail: 'c@example.com', ...o })]).slice(1))[1]?.slice(7, 9);
    expect(ends({ length: 'unlimited' })).toEqual(['Unlimited', 'Unlimited']);
    expect(ends({ length: 1, endsAt: at(2026, 10, 29, 9, 0) })).toEqual(['1 day', '2026-10-29 09:00']);
    expect(ends({ endsUnreadable: true, ended: true })).toEqual(['', 'Not readable']);
  });

  it('holds counts and the list’s own fields only, never content: no words or file names of any show', () => {
    const rows = readCsv(accessListCsv(people).slice(1));
    expect(rows[0]).toEqual([
      'Gmail',
      'Name',
      'Status',
      'Requested',
      'Approved',
      'Rejected',
      'Revoked',
      'Length',
      'Access ends',
      'Computers',
      'Last seen',
      'Minutes used',
      'Shows',
      'Streams',
      'Recordings',
      'Imports',
      'Note',
    ]);
    for (const row of rows) expect(row).toHaveLength(CSV_COLUMNS.length);
    // The counts are whole numbers and nothing else.
    const counts = ['Minutes used', 'Shows', 'Streams', 'Recordings', 'Imports'].map((c) =>
      CSV_COLUMNS.indexOf(c as (typeof CSV_COLUMNS)[number]),
    );
    for (const row of rows.slice(1)) for (const i of counts) expect(row[i]).toMatch(/^\d+$/u);
    // Whatever else a person's record were to carry, only these columns are written.
    const extra = { ...people[0], slides: ['Placeholder words'], files: ['placeholder.mp4'] } as AccessPerson;
    const text = accessListCsv([extra]);
    expect(text).not.toContain('Placeholder words');
    expect(text).not.toContain('placeholder.mp4');
  });

  it('is only the header for no Gmails', () => {
    expect(accessListCsv([])).toBe(`\uFEFF${CSV_COLUMNS.join(',')}\r\n`);
  });
});
