import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  ACCESS_MAC_PREFIX,
  ACCESS_VERSION,
  canonicalJson,
  type AccessComputer,
  type AccessGrant,
} from '../src/shared/access-protocol';

export { NO_ACTIVITY } from '../src/shared/access-protocol';

/*
 * The access list's own code (access-list/core.js, Session 54, E1) for the tests, with everything it needs
 * from Google made here instead: a Sheet in memory (the owner may "type" in it), a cache and the list's
 * clock that a test moves, a mailbox a test reads (for a token, or an Approve link), and a signing key made
 * for the test. The same core.js runs in the owner's Google account, so the tests exercise the real rules.
 * Placeholder addresses only (example.com).
 */

export interface SentMail {
  to: string;
  subject: string;
  body: string;
  at: number;
}

export interface ListProps {
  approverEmail: string;
  webAppUrl: string;
  linkKey: string;
  secretKey: string;
  hasSigningKey: boolean;
}

export type Cell = string | number | boolean | Date | null;

/** What core.js is given (Code.js makes the same from Google's services). */
export interface ListEnv {
  now(): number;
  randomBytes(n: number): number[];
  sha256Hex(text: string): string;
  hmacHex(key: string, text: string): string;
  sign(text: string): string;
  formatTime(ms: number): string;
  props(): ListProps | null;
  /** The script's settings (Script Properties), read and written as they are. */
  properties: { get(key: string): string | null; set(key: string, value: string): void };
  mail: { remaining(): number; send(mail: { to: string; subject: string; body: string }): void };
  lock<T>(fn: () => T): T;
  flush(): void;
  cache: {
    get(key: string): string | null;
    put(key: string, value: string, seconds: number): void;
    remove(key: string): void;
    getAll(keys: string[]): Record<string, string>;
    putAll(values: Record<string, string>, seconds: number): void;
  };
  sheet: {
    read(tab: string): Cell[][];
    row(tab: string, row: number): Cell[];
    column(tab: string, col: number): Cell[];
    write(tab: string, row: number, col: number, value: Cell): void;
    append(tab: string, values: Cell[]): number;
    /** A column added after the last, its header bold, hidden or shown as dates when asked: its number. */
    addColumn(tab: string, header: string, o: { hidden: boolean; date: boolean }): number;
  };
  log?(text: string): void;
}

export interface LinkPage {
  kind: string;
  title: string;
  lines: string[];
  button: string | null;
  params: Record<string, string> | null;
  /** An Approve page's lengths: the days offered, the most typed, and the one chosen at first. */
  lengths: { days: number[]; maxDays: number; chosen: number | 'unlimited' } | null;
}

export interface SheetColumn {
  field: string;
  header: string;
  date: boolean;
  number: boolean;
  hidden: boolean;
}

/** access-list/core.js, as it exports itself in Node. */
export interface AccessCore {
  PROTOCOL: {
    version: number;
    checkEveryMs: number;
    stopAfterMs: number;
    tokenMs: number;
    linkMs: number;
    limits: Record<string, number>;
    publicOps: string[];
    ownerOps: string[];
    statuses: string[];
    checkStatuses: string[];
    requestStatuses: string[];
    errors: string[];
    tokenAlphabet: string;
    tokenLength: number;
    macPrefix: string;
    lengths: { days: number[]; maxDays: number };
  };
  MESSAGES: Record<string, string>;
  handle(env: ListEnv, text: string): { payload: string; sig: string };
  linkPage(env: ListEnv, params: Record<string, string>): LinkPage;
  answerLink(env: ListEnv, params: Record<string, string>): LinkPage;
  letOwnerIn(env: ListEnv): { ok: true; to: string; runsOut: number };
  sheetLayout(): { tab: string; columns: SheetColumn[] }[];
  canonicalJson(value: unknown): string;
  gmailKey(address: string): string;
  gmailShaped(address: string): boolean;
  normaliseToken(typed: string): string | null;
  formatToken(token: string): string;
  cleanText(value: unknown, max: number): string;
  sameText(a: string, b: string): boolean;
}

export const ACCESS_LIST_DIR = join(__dirname, '..', 'access-list');

export const core = createRequire(__filename)(join(ACCESS_LIST_DIR, 'core.js')) as AccessCore;

export const PEOPLE = 'Access List';
export const COMPUTERS = 'Computers';

/** The owner's own address in every test: a placeholder, never a real one. */
export const PLACEHOLDER_APPROVER = 'owner.placeholder@example.com';

/** A Sheet in memory, its tabs and headers as Drashti › Set up… makes them. */
export class MemorySheet {
  readonly tabs = new Map<string, Cell[][]>();
  /** Cells written, by the list (a test counts them). */
  writes = 0;
  /** The columns the list added itself, in order. */
  readonly added: { tab: string; header: string; hidden: boolean; date: boolean }[] = [];

  constructor() {
    for (const { tab, columns } of core.sheetLayout()) this.tabs.set(tab, [columns.map((c) => c.header)]);
  }

  private rows(tab: string): Cell[][] {
    const rows = this.tabs.get(tab);
    if (!rows) throw new Error(`No tab ${tab}`);
    return rows;
  }

  read(tab: string): Cell[][] {
    return (this.tabs.get(tab) ?? []).map((r) => [...r]);
  }

  row(tab: string, row: number): Cell[] {
    return [...(this.rows(tab)[row - 1] ?? [])];
  }

  column(tab: string, col: number): Cell[] {
    return this.rows(tab).map((r) => r[col - 1] ?? '');
  }

  write(tab: string, row: number, col: number, value: Cell): void {
    const rows = this.rows(tab);
    while (rows.length < row) rows.push([]);
    const r = rows[row - 1] ?? [];
    while (r.length < col) r.push('');
    r[col - 1] = value;
    this.writes++;
  }

  append(tab: string, values: Cell[]): number {
    const rows = this.rows(tab);
    rows.push([...values]);
    return rows.length;
  }

  addColumn(tab: string, header: string, o: { hidden: boolean; date: boolean }): number {
    const head = this.rows(tab)[0] ?? [];
    let col = head.length;
    while (col > 0 && (head[col - 1] === '' || head[col - 1] === null)) col--;
    this.write(tab, 1, col + 1, header);
    this.added.push({ tab, header, hidden: o.hidden, date: o.date });
    return col + 1;
  }

  /** A column taken away, its cells with it (as a Sheet set up before the column came had it). */
  removeColumn(tab: string, header: string): void {
    const c = this.col(tab, header);
    this.tabs.set(
      tab,
      this.rows(tab).map((r) => r.filter((_, i) => i !== c)),
    );
  }

  private col(tab: string, header: string): number {
    const i = (this.rows(tab)[0] ?? []).findIndex((h) => String(h).toLowerCase() === header.toLowerCase());
    if (i < 0) throw new Error(`No column ${header} in ${tab}`);
    return i;
  }

  /** Every row of a tab as { header: value }. */
  records(tab: string): Record<string, Cell>[] {
    const [header = [], ...rows] = this.rows(tab);
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [String(h), r[i] ?? ''])));
  }

  /** The first row whose `header` cell is `value`, as { header: value }. */
  find(tab: string, header: string, value: string): Record<string, Cell> | undefined {
    return this.records(tab).find((r) => String(r[header]) === value);
  }

  /** The owner typing in the Sheet: the first row whose `matchHeader` cell is `matchValue`. */
  type(tab: string, matchHeader: string, matchValue: string, header: string, value: Cell): void {
    const rows = this.rows(tab);
    const m = this.col(tab, matchHeader);
    const row = rows.findIndex((r, i) => i > 0 && String(r[m]) === matchValue);
    if (row < 0) throw new Error(`No row with ${matchHeader} ${matchValue}`);
    const c = this.col(tab, header);
    const r = rows[row] ?? [];
    while (r.length <= c) r.push('');
    r[c] = value;
  }

  /** The owner sorting a tab (by a column, backwards): every row moves. */
  sortBy(tab: string, header: string): void {
    const [head, ...rows] = this.rows(tab);
    const c = this.col(tab, header);
    rows.sort((a, b) => String(b[c] ?? '').localeCompare(String(a[c] ?? '')));
    this.tabs.set(tab, [head ?? [], ...rows]);
  }

  /** The owner putting a column of their own in front of the others. */
  insertFirstColumn(tab: string, header: string): void {
    this.tabs.set(
      tab,
      this.rows(tab).map((r, i) => [i === 0 ? header : '', ...r]),
    );
  }
}

/** Google's script cache, on the list's clock: what is put lasts as long as it was put for, or less. */
export class MemoryCache {
  private readonly items = new Map<string, { value: string; until: number }>();

  constructor(private readonly now: () => number) {}

  get(key: string): string | null {
    const item = this.items.get(key);
    if (!item || item.until <= this.now()) {
      this.items.delete(key);
      return null;
    }
    return item.value;
  }

  put(key: string, value: string, seconds: number): void {
    if (key.length > 250) throw new Error('A cache key is at most 250 characters.');
    // Google's maximum: nothing is kept in its cache longer than 6 hours.
    if (seconds > 21_600) throw new Error('A cached value lasts at most 21600 seconds (6 hours).');
    if (value.length > 100_000) throw new Error('A cached value is at most 100 KB.');
    this.items.set(key, { value, until: this.now() + seconds * 1000 });
  }

  remove(key: string): void {
    this.items.delete(key);
  }

  getAll(keys: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = this.get(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  putAll(values: Record<string, string>, seconds: number): void {
    for (const [k, v] of Object.entries(values)) this.put(k, v, seconds);
  }

  /** Google may empty the cache at any time. */
  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

export interface TestKeys {
  privateKey: KeyObject;
  /** SPKI, base64: what Drashti has built in (or a test switch gives). */
  publicKey: string;
}

/** A signing key pair made for a test (never a real one). */
export function makeTestKeys(): TestKeys {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

export interface TestListOptions {
  keys?: TestKeys;
  approver?: string;
  webAppUrl?: string;
  /** Emails the list may send today (Google's free account: 100). */
  mailQuota?: number;
  start?: number;
}

/** The list, with Google's services made in memory. */
export class TestList {
  readonly keys: TestKeys;
  readonly sheet = new MemorySheet();
  readonly cache: MemoryCache;
  readonly mailbox: SentMail[] = [];
  /** The script's settings beyond the ones props() gives (what the list writes there itself). */
  readonly properties = new Map<string, string>();
  readonly props: ListProps;
  readonly env: ListEnv;
  t: number;
  mailQuota: number;
  /** The next email fails to go (as MailApp can throw). */
  failNextMail = false;
  /** The script's lock is held elsewhere for longer than the list waits. */
  lockBusy = false;
  locks = 0;
  logs: string[] = [];

  constructor(o: TestListOptions = {}) {
    this.keys = o.keys ?? makeTestKeys();
    this.t = o.start ?? Date.UTC(2026, 9, 27, 10, 0, 0);
    this.mailQuota = o.mailQuota ?? 100;
    this.cache = new MemoryCache(() => this.t);
    this.props = {
      approverEmail: o.approver ?? PLACEHOLDER_APPROVER,
      webAppUrl: o.webAppUrl ?? 'https://script.google.com/macros/s/placeholder-list/exec',
      linkKey: randomBytes(32).toString('hex'),
      secretKey: randomBytes(32).toString('hex'),
      hasSigningKey: true,
    };
    let depth = 0;
    this.env = {
      now: () => this.t,
      randomBytes: (n) => [...randomBytes(n)],
      sha256Hex: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
      hmacHex: (key, text) =>
        createHmac('sha256', Buffer.from(key, 'utf8')).update(text, 'utf8').digest('hex'),
      sign: (text) => sign('sha256', Buffer.from(text, 'utf8'), this.keys.privateKey).toString('base64'),
      formatTime: (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      props: () => this.props,
      properties: {
        get: (key) => this.properties.get(key) ?? null,
        set: (key, value) => {
          if (value.length > 9 * 1024) throw new Error('A script property is at most 9 KB.');
          this.properties.set(key, value);
        },
      },
      mail: {
        remaining: () => this.mailQuota - this.mailbox.length,
        send: (m) => {
          if (this.failNextMail) {
            this.failNextMail = false;
            throw new Error('Placeholder mail failure');
          }
          if (this.mailbox.length >= this.mailQuota)
            throw new Error('Service invoked too many times for one day: email.');
          this.mailbox.push({ ...m, at: this.t });
        },
      },
      lock: <T>(fn: () => T): T => {
        if (this.lockBusy) throw new Error('busy');
        if (depth > 0) throw new Error('The list took its lock twice.');
        depth++;
        this.locks++;
        try {
          return fn();
        } finally {
          depth--;
        }
      },
      flush: () => undefined,
      cache: this.cache,
      sheet: this.sheet,
      log: (text) => this.logs.push(text),
    };
  }

  move(ms: number): void {
    this.t += ms;
  }

  /** One call to the list as the web app takes it: JSON text in, { payload, sig } out. */
  handle(text: string): { payload: string; sig: string } {
    return core.handle(this.env, text);
  }

  /** The emails to an address (newest last). */
  mailTo(address: string): SentMail[] {
    return this.mailbox.filter((m) => m.to === address);
  }

  /** The newest token emailed to an address. */
  tokenFor(address: string): string | null {
    const mails = this.mailTo(address).filter((m) => m.subject === 'Your Drashti token');
    const body = mails[mails.length - 1]?.body ?? '';
    return /\b([0-9A-Z]{4}(?:-[0-9A-Z]{4}){6})\b/u.exec(body)?.[1] ?? null;
  }

  /** The newest Approve and Reject links emailed to the approver for a Gmail. */
  linksFor(gmail: string): { approve: string; reject: string } | null {
    const mails = this.mailTo(this.props.approverEmail).filter((m) => m.subject.includes(gmail));
    const body = mails[mails.length - 1]?.body ?? '';
    const approve = /Approve: (\S+)/u.exec(body)?.[1];
    const reject = /Reject: (\S+)/u.exec(body)?.[1];
    return approve && reject ? { approve, reject } : null;
  }
}

/** A link's query as the web app's doGet hands it on (e.parameter). */
export function linkParams(link: string): Record<string, string> {
  return Object.fromEntries(new URL(link).searchParams.entries());
}

export interface AnswerPayload {
  v: number;
  op: string;
  nonce: string;
  computerId: string;
  serverTime: number;
  ok: boolean;
  error?: string;
  message?: string;
  [field: string]: unknown;
}

/** A placeholder computer's id: as Drashti makes one (SHA-256 of "drashti-access:" and a hardware id). */
export const placeholderComputerId = (hardwareId: string): string =>
  createHash('sha256').update(`drashti-access:${hardwareId}`, 'utf8').digest('hex');

export const placeholderComputer = (hardwareId: string, name = 'Placeholder Mac'): AccessComputer => ({
  id: placeholderComputerId(hardwareId),
  name,
  version: '1.0.0-alpha.13',
  platform: 'darwin',
});

/** A call's body as Drashti sends it: a fresh nonce, and the mac when it is signed with a grant. */
export function callBody(
  op: string,
  computer: AccessComputer,
  fields: Record<string, unknown>,
  grant?: AccessGrant,
): { body: Record<string, unknown>; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const body: Record<string, unknown> = { v: ACCESS_VERSION, op, nonce, computer, ...fields };
  if (grant) {
    body['gmail'] = grant.gmail;
    body['grantId'] = grant.grantId;
    body['mac'] = createHmac('sha256', Buffer.from(grant.secret, 'utf8'))
      .update(`${ACCESS_MAC_PREFIX}${canonicalJson(body)}`, 'utf8')
      .digest('hex');
  }
  return { body, nonce };
}

/** An answer's payload, its signature checked with the list's public key (throws when it is wrong). */
export function readAnswer(answer: { payload: string; sig: string }, publicKey: string): AnswerPayload {
  const key = { key: Buffer.from(publicKey, 'base64'), format: 'der' as const, type: 'spki' as const };
  if (!verify('sha256', Buffer.from(answer.payload, 'utf8'), key, Buffer.from(answer.sig, 'base64')))
    throw new Error('The answer’s signature is wrong.');
  return JSON.parse(answer.payload) as AnswerPayload;
}
