import { describe, expect, it } from 'vitest';
import { ACCESS_ERRORS, type AccessPerson } from './access-protocol';
import {
  accessListCsv,
  CSV_COLUMNS,
  csvTime,
  DEFAULT_SORT,
  editsFor,
  formatDay,
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
  it('follow its status: a request Approve or Reject, approved Give access again or Revoke, and a note for all', () => {
    expect(editsFor(person({ gmail: 'a@example.com', status: 'requested' }))).toEqual([
      'approve',
      'reject',
      'note',
    ]);
    expect(editsFor(person({ gmail: 'a@example.com', status: 'approved' }))).toEqual([
      'regrant',
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
      'revoke',
      'note',
    ]);
  });

  it('never offer Revoke or Reject on the owner’s own row', () => {
    for (const status of ['requested', 'approved', 'rejected', 'revoked', 'paused']) {
      const edits = editsFor(person({ gmail: 'owner.placeholder@example.com', status, owner: true }));
      expect(edits, status).not.toContain('revoke');
      expect(edits, status).not.toContain('reject');
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
