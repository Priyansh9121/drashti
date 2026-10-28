import { leftText } from './access';
import {
  ACCESS_ERROR_TEXT,
  ACCESS_LENGTH_DAYS,
  ACCESS_LENGTH_MAX_DAYS,
  ACCESS_STATUSES,
  ACCESS_UNLIMITED,
  gmailKey,
  type AccessErrorCode,
  type AccessLength,
  type AccessPerson,
  type AccessStatus,
} from './access-protocol';
import { plural } from './text';

/*
 * View › Access List… (Session 54, E4): the owner's own window onto the access list in their Google account
 * (access-list/PROTOCOL.md, "The owner's calls"). Only the owner's computer has it, and only its main process
 * asks the list (src/main/access/access-list.ts). Here: what the window is told, and the rules both sides keep:
 * the columns, sorting, the status filter and the search, which edits a Gmail is offered (never Revoke, Reject or a
 * length on the owner's own row), the lengths of access offered (the owner's decision of 28 Oct 2026: Unlimited
 * first), the words for each, and the CSV the owner saves. Counts only, never content:
 * the list holds no words, file names or pictures of anyone's shows, so nothing here can.
 */

/** The window's title. */
export const ACCESS_LIST_TITLE = 'Drashti Access List';

/** While the window is open, the list is asked again this long after each answer. */
export const ACCESS_LIST_REFRESH_MS = 5_000;

/** What the window shows. */
export interface AccessListView {
  /** Every Gmail on the list, in the Sheet's order, as the list last answered; null before its first answer. */
  people: AccessPerson[] | null;
  /** When that answer came (this computer's clock, ms), or null. */
  updatedAt: number | null;
  /** The list's own time when it answered (ms), or null: how long is left of a length is counted from it. */
  listTime: number | null;
  /** Why the last time the list was asked brought no answer, in words (it is asked again by itself), or null. */
  problem: string | null;
}

export const NO_VIEW: AccessListView = { people: null, updatedAt: null, listTime: null, problem: null };

/**
 * A Gmail added by the owner: a row requested (the request emailed), approved at once when `approve`; `length` is how
 * long access lasts once approved.
 */
export interface AccessListAdd {
  gmail: string;
  name: string;
  note: string;
  approve: boolean;
  length: AccessLength;
}

// ---- lengths of access (the owner's decision of 28 Oct 2026) ----

/** The lengths the owner chooses from, in the order offered: Unlimited first (chosen at first), then the days. */
export const LENGTH_CHOICES: readonly { length: AccessLength; label: string }[] = [
  { length: ACCESS_UNLIMITED, label: 'Unlimited, until you revoke it' },
  ...ACCESS_LENGTH_DAYS.map((days) => ({
    length: days,
    label: days === 1 ? '1 day (24 hours)' : `${String(days)} days`,
  })),
];

/** The most days that may be typed in for a length (the list refuses more). */
export const LENGTH_MAX_DAYS = ACCESS_LENGTH_MAX_DAYS;

/** A length in a word or two: "Unlimited", "1 day", "30 days". */
export const lengthWord = (length: AccessLength): string =>
  length === ACCESS_UNLIMITED ? 'Unlimited' : plural(length, 'day');

/** Days typed for a length, read as the list reads them: a whole number from 1 to LENGTH_MAX_DAYS, or null. */
export function typedDays(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,4}$/u.test(t)) return null;
  const days = Number(t);
  return days >= 1 && days <= LENGTH_MAX_DAYS ? days : null;
}

/** What the Access ends cell says for a Gmail: its first line, a second, and whether it needs a look. */
export function endsCell(
  p: AccessPerson,
  listTime: number | null,
): { text: string; detail: string; warn: boolean } {
  if (knownStatus(p.status) === 'requested' && p.length !== null && p.length !== ACCESS_UNLIMITED)
    return { text: '', detail: `${lengthWord(p.length)} once approved`, warn: false };
  if (knownStatus(p.status) !== 'approved') return { text: '', detail: '', warn: false };
  if (p.owner) return { text: 'Unlimited', detail: 'Your own: always', warn: false };
  if (p.endsUnreadable)
    return {
      text: 'Can’t be read',
      detail: 'Put the date right in the Sheet: their Drashti stops until then',
      warn: true,
    };
  if (p.endsAt === null) return { text: 'Unlimited', detail: '', warn: false };
  if (p.ended)
    return { text: `Ended ${formatDay(p.endsAt)}`, detail: 'Their Drashti has stopped', warn: true };
  return {
    text: formatDay(p.endsAt),
    detail: listTime === null ? '' : `In ${leftText(p.endsAt - listTime)}`,
    warn: false,
  };
}

/** An edit's outcome: what happened in words, and the list as it is afterwards (asked again). */
export interface AccessListResult {
  ok: boolean;
  message: string;
  view: AccessListView;
}

/** The CSV saved, or why not (null: the save dialog was cancelled, which needs no words). */
export interface AccessListSaved {
  ok: boolean;
  message: string | null;
}

/** The longest name and note the list keeps (access-list/core.js cuts them there too). */
export const ACCESS_NAME_MAX = 60;
export const ACCESS_NOTE_MAX = 500;

// ---- statuses ----

/** The statuses in the order the filter shows them and the Status column sorts them: requests waiting first. */
export const STATUS_ORDER: readonly AccessStatus[] = ['requested', 'approved', 'revoked', 'rejected'];

export const STATUS_WORDS: Record<AccessStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  revoked: 'Revoked',
  rejected: 'Rejected',
};

/** The status filter: every Gmail, or one status. */
export type StatusFilter = 'all' | AccessStatus;

/** A status the list knows, or null for one typed into the Sheet that it does not (which stops that Gmail). */
export function knownStatus(status: string): AccessStatus | null {
  const s = status.trim().toLowerCase();
  return (ACCESS_STATUSES as readonly string[]).includes(s) ? (s as AccessStatus) : null;
}

/** A status in words: its own, or Other for one the list does not know (none at all: No status). */
export function statusWord(status: string): string {
  const known = knownStatus(status);
  if (known) return STATUS_WORDS[known];
  return status.trim() === '' ? 'No status' : 'Other';
}

/** A status's colour as a badge: a request needs a look; approved is in; revoked removed; rejected quiet. */
export function statusTone(status: string): 'warning' | 'success' | 'danger' | 'neutral' {
  switch (knownStatus(status)) {
    case 'requested':
      return 'warning';
    case 'approved':
      return 'success';
    case 'revoked':
      return 'danger';
    case 'rejected':
      return 'neutral';
    default:
      return 'warning';
  }
}

/** How access-list/core.js names a request the owner made by adding a Gmail. */
const ADDED_BY_OWNER = 'added by the owner';

/** The Status cell's second line: where a request came from, a token waiting, the day of a rejection. */
export function statusDetail(p: AccessPerson): string {
  switch (knownStatus(p.status)) {
    case 'requested':
      if (!p.request) return '';
      return p.request.computer === ADDED_BY_OWNER ? 'Added by you' : `Asked from ${p.request.computer}`;
    case 'approved':
      if (p.token) return `Token sent: runs out ${formatDay(p.token.runsOut)}`;
      return p.computers.some((c) => !c.ended) ? '' : 'No computer in yet';
    case 'rejected':
      return p.rejectedAt === null ? '' : `On ${formatDay(p.rejectedAt)}`;
    case 'revoked':
      return '';
    default:
      return p.status.trim() === ''
        ? 'No status in the Sheet: their Drashti stops'
        : `“${p.status.trim()}” in the Sheet: their Drashti stops`;
  }
}

/** How many Gmails each filter shows. */
export function statusCounts(people: readonly AccessPerson[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: people.length,
    requested: 0,
    approved: 0,
    revoked: 0,
    rejected: 0,
  };
  for (const p of people) {
    const s = knownStatus(p.status);
    if (s) counts[s]++;
  }
  return counts;
}

// ---- the columns ----

export type AccessColumn =
  | 'gmail'
  | 'status'
  | 'requested'
  | 'approved'
  | 'ends'
  | 'revoked'
  | 'computers'
  | 'lastSeen'
  | 'minutes'
  | 'shows'
  | 'streams'
  | 'recordings'
  | 'imports'
  | 'note';

/** The table's columns, left to right; `numeric` ones are counts, right-aligned. */
export const ACCESS_COLUMNS: readonly { id: AccessColumn; label: string; numeric?: true }[] = [
  { id: 'gmail', label: 'Gmail and name' },
  { id: 'status', label: 'Status' },
  { id: 'requested', label: 'Requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'ends', label: 'Access ends' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'computers', label: 'Computer and version' },
  { id: 'lastSeen', label: 'Last seen' },
  { id: 'minutes', label: 'Time used', numeric: true },
  { id: 'shows', label: 'Shows', numeric: true },
  { id: 'streams', label: 'Streams', numeric: true },
  { id: 'recordings', label: 'Recordings', numeric: true },
  { id: 'imports', label: 'Imports', numeric: true },
  { id: 'note', label: 'Note' },
];

export interface AccessSort {
  column: AccessColumn;
  descending: boolean;
}

/** As the window opens: by status, so requests waiting come first. */
export const DEFAULT_SORT: AccessSort = { column: 'status', descending: false };

/** The computers a Gmail has in now (their tokens used, not ended), then those ended, each in the list's order. */
export function computersOf(p: AccessPerson): AccessPerson['computers'] {
  return [...p.computers.filter((c) => !c.ended), ...p.computers.filter((c) => c.ended)];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** What a column sorts by; null (no date, no note) always goes last. */
function sortValue(p: AccessPerson, column: AccessColumn): string | number | null {
  switch (column) {
    case 'gmail':
      return p.gmail;
    case 'status': {
      // A status the list does not know after the four it does.
      const s = knownStatus(p.status);
      return s === null ? STATUS_ORDER.length : STATUS_ORDER.indexOf(s);
    }
    case 'requested':
      return p.requestedAt;
    case 'approved':
      return p.approvedAt;
    case 'ends':
      // Those approved only: one that cannot be read first, then by their end, Unlimited after every date.
      if (knownStatus(p.status) !== 'approved') return null;
      if (p.endsUnreadable) return 0;
      return p.endsAt ?? Number.MAX_SAFE_INTEGER;
    case 'revoked':
      return p.revokedAt;
    case 'computers':
      return p.computers.filter((c) => !c.ended).length;
    case 'lastSeen':
      return p.lastSeen;
    case 'note':
      return p.note.trim() === '' ? null : p.note;
    default:
      return p[column];
  }
}

/** The Gmails sorted by a column, either way; ties (and empty values, always last) by Gmail. */
export function sortPeople(people: readonly AccessPerson[], sort: AccessSort): AccessPerson[] {
  const keyed = people.map((p, i) => ({ p, i, v: sortValue(p, sort.column) }));
  const tie = (a: (typeof keyed)[number], b: (typeof keyed)[number]) =>
    collator.compare(a.p.gmail, b.p.gmail) || a.i - b.i;
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) return a.v === b.v ? tie(a, b) : a.v === null ? 1 : -1;
    const c =
      typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : collator.compare(String(a.v), String(b.v));
    if (c !== 0) return sort.descending ? -c : c;
    return tie(a, b);
  });
  return keyed.map((k) => k.p);
}

/** Text as the search compares it: one form of each letter, in small letters. */
const searchForm = (text: string) => text.normalize('NFKC').toLowerCase();

/** Whether a Gmail matches what was typed: every word in its Gmail, name, status, note or a computer's name or version. */
export function matchesSearch(p: AccessPerson, search: string): boolean {
  const words = searchForm(search).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const hay = searchForm(
    [
      p.gmail,
      gmailKey(p.gmail),
      p.name,
      statusWord(p.status),
      p.note,
      ...p.computers.map((c) => `${c.name} ${c.version} ${platformWord(c.platform)}`),
    ].join('\n'),
  );
  return words.every((w) => hay.includes(w));
}

/** The rows the table shows: those of the status chosen that match the search, sorted. */
export function shownPeople(
  people: readonly AccessPerson[],
  o: { status: StatusFilter; search: string; sort: AccessSort },
): AccessPerson[] {
  return sortPeople(
    people.filter(
      (p) => (o.status === 'all' || knownStatus(p.status) === o.status) && matchesSearch(p, o.search),
    ),
    o.sort,
  );
}

// ---- the edits ----

export type AccessEdit = 'approve' | 'reject' | 'regrant' | 'length' | 'revoke' | 'note';

export const EDIT_WORDS: Record<AccessEdit, string> = {
  approve: 'Approve…',
  reject: 'Reject',
  regrant: 'Give access again…',
  length: 'Change the length…',
  revoke: 'Revoke…',
  note: 'Edit note…',
};

/**
 * What the window offers for a Gmail, by its status: a request Approve or Reject; an approved Gmail Give access
 * again (a new token, for one more computer), Change the length and Revoke; a rejected one Approve; a revoked one
 * Give access again; one with a status the list does not know (typed into the Sheet) Give access again, which puts
 * it right. Approve, Give access again and Change the length each ask how long access lasts. Never Revoke, Reject
 * or a length on the owner's own row (always Unlimited; the list refuses them too). Every row may have its note
 * edited.
 */
export function editsFor(p: AccessPerson): AccessEdit[] {
  const edits: AccessEdit[] = [];
  switch (knownStatus(p.status)) {
    case 'requested':
      edits.push('approve');
      if (!p.owner) edits.push('reject');
      break;
    case 'approved':
      edits.push('regrant');
      if (!p.owner) edits.push('length', 'revoke');
      break;
    case 'rejected':
      edits.push('approve');
      break;
    default:
      edits.push('regrant');
  }
  edits.push('note');
  return edits;
}

/** Revoke asks first, in these words. */
export const REVOKE_QUESTION = {
  title: (gmail: string) => `Revoke ${gmail}?`,
  body: 'Their Drashti stops at once, screens and stream included.',
  more: 'Give access again lets them back in later, with a new token.',
  confirm: 'Revoke',
} as const;

/**
 * The list's refusals as the owner is told them: Drashti's own words (ACCESS_ERROR_TEXT), but where those speak
 * to a person asking for access, words for the owner.
 */
export function ownerErrorText(error: AccessErrorCode): string {
  switch (error) {
    case 'already-approved':
      return 'That Gmail is approved already: the list changed meanwhile, and shows it as it is now.';
    case 'wrong-status':
      return 'That Gmail’s status changed meanwhile: the list shows it as it is now. Choose again.';
    case 'not-found':
      return 'That Gmail is no longer on the list: was its row taken out of the Sheet?';
    case 'not-set-up':
      return 'The access list is not set up yet: open Drashti › Set up… in its Sheet.';
    case 'server':
      return `${ACCESS_ERROR_TEXT.server} If it goes on, open Drashti › Set up… in the Sheet: it puts back a tab or column taken away.`;
    default:
      return ACCESS_ERROR_TEXT[error];
  }
}

/** The list was not reached when it was asked for itself (it is asked again by itself). */
export const NO_ANSWER_TEXT =
  'Drashti couldn’t reach the access list: check the internet connection. It asks again every few seconds.';

/** An edit sent and no answer heard: it may or may not have been done. */
export const EDIT_NO_ANSWER_TEXT =
  'Drashti couldn’t hear back from the access list: check the internet connection. The list shows whether it was done once it answers again.';

// ---- words ----

/** A computer's system in words. */
export function platformWord(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'Mac';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return '';
  }
}

/** A day as the table shows it: "27 Oct 2026" (nothing for no date). */
export function formatDay(ms: number | null): string {
  return ms === null
    ? ''
    : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Time used: "45 min", "3 h 5 min", "120 h" (from 100 hours, whole hours), "None" for none. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m === 0) return 'None';
  if (m < 60) return `${String(m)} min`;
  const h = Math.floor(m / 60);
  if (h >= 100) return `${h.toLocaleString('en')} h`;
  return m % 60 === 0 ? `${String(h)} h` : `${String(h)} h ${String(m % 60)} min`;
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** When a Gmail was last seen: "Just now", "5 minutes ago", "Today at 9:40", "Yesterday at 18:05", a day; "Never". */
export function formatSeen(ms: number | null, now: number): string {
  if (ms === null) return 'Never';
  const ago = now - ms;
  if (ago < 2 * 60_000) return 'Just now';
  if (ago < 60 * 60_000) return `${plural(Math.floor(ago / 60_000), 'minute')} ago`;
  const days = Math.round((dayStart(now) - dayStart(ms)) / (24 * 60 * 60_000));
  if (days === 0) return `Today at ${timeOf(ms)}`;
  if (days === 1) return `Yesterday at ${timeOf(ms)}`;
  return formatDay(ms);
}

/** When the list last answered, in words: "Updated just now"; while it cannot be reached, how long ago. */
export function updatedWords(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'Not updated yet';
  const ago = Math.max(0, now - updatedAt);
  if (ago < 15_000) return 'Updated just now';
  if (ago < 60_000) return 'Updated less than a minute ago';
  if (ago < 60 * 60_000) return `Updated ${plural(Math.floor(ago / 60_000), 'minute')} ago`;
  return `Updated at ${timeOf(updatedAt)}`;
}

/** One computer in a line: its name, its Drashti's version, and its system. */
export function computerLine(c: AccessPerson['computers'][number]): string {
  const system = platformWord(c.platform);
  return [c.name || 'A computer', c.version, system].filter(Boolean).join(' · ');
}

// ---- the CSV ----

/** The CSV's columns: the table's, with each date its own column and minutes as a number. Never content. */
export const CSV_COLUMNS = [
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
] as const;

/** A date and time as a spreadsheet reads it, in this computer's time zone: "2026-10-27 18:05". */
export function csvTime(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * One field: quoted when it holds a comma, a quote or a line's end (RFC 4180). Words someone typed that a
 * spreadsheet would run as a formula (=, +, -, @, a tab or a return first) start with an apostrophe instead.
 */
function csvField(value: string | number, typed: boolean): string {
  let text = typeof value === 'number' ? String(value) : value;
  if (typed && /^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** The computers of one Gmail in one field: "Placeholder Mac (Mac, 1.0.0-alpha.13); …", those ended said so. */
function csvComputers(p: AccessPerson): string {
  return computersOf(p)
    .map((c) => {
      const about = [
        platformWord(c.platform),
        c.version,
        c.ended ? `ended${c.endedWhy ? `: ${c.endedWhy}` : ''}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `${c.name || 'A computer'}${about ? ` (${about})` : ''}`;
    })
    .join('; ');
}

/**
 * The Gmails as a CSV file's text, in the order given: a byte-order mark first (so a spreadsheet reads names
 * in any script as written), the header, a row for each, every line ending CRLF.
 */
export function accessListCsv(people: readonly AccessPerson[]): string {
  const rows = people.map((p) => [
    csvField(p.gmail, true),
    csvField(p.name, true),
    csvField(statusWord(p.status), true),
    csvTime(p.requestedAt),
    csvTime(p.approvedAt),
    csvTime(p.rejectedAt),
    csvTime(p.revokedAt),
    p.length === null ? '' : csvField(lengthWord(p.length), false),
    knownStatus(p.status) !== 'approved'
      ? ''
      : p.endsUnreadable
        ? 'Not readable'
        : p.endsAt === null
          ? 'Unlimited'
          : csvTime(p.endsAt),
    csvField(csvComputers(p), true),
    csvTime(p.lastSeen),
    csvField(p.minutes, false),
    csvField(p.shows, false),
    csvField(p.streams, false),
    csvField(p.recordings, false),
    csvField(p.imports, false),
    csvField(p.note, true),
  ]);
  return `\uFEFF${[[...CSV_COLUMNS], ...rows].map((r) => r.join(',')).join('\r\n')}\r\n`;
}
