import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_LIST_DIR,
  callBody,
  core,
  linkParams,
  MemoryCache,
  PLACEHOLDER_APPROVER,
  placeholderComputer,
  readAnswer,
} from '../../../tests/access-core';

/*
 * access-list/Code.js, the list's Apps Script side (Session 54, E1), run as Apps Script runs it: core.js and
 * Code.js in one global scope, with Google's services made here (a Sheet, Script Properties, the cache,
 * the lock, MailApp, Utilities giving Java's signed bytes, the Sheet's menu and windows). Nobody signs in to
 * Google from a test; this checks Code.js's own part: how it hands Google's answers to core.js, its Set up…
 * window's calls, and that a web page can call nothing that matters by name.
 */

type Value = string | number | boolean | Date | null;
const signed = (b: Buffer) => [...b].map((x) => (x > 127 ? x - 256 : x));
const unsigned = (bytes: number[]) => Buffer.from(bytes.map((x) => x & 255));
const PERSON = 'placeholder.user@example.com';
const URL = 'https://script.google.com/macros/s/placeholder-web-app-id/exec';

class FakeRange {
  constructor(
    private readonly sheet: FakeSheet,
    private readonly r: number,
    private readonly c: number,
    private readonly nr = 1,
    private readonly nc = 1,
  ) {}

  getValues(): Value[][] {
    return Array.from({ length: this.nr }, (_, i) =>
      Array.from({ length: this.nc }, (__, j) => this.sheet.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? ''),
    );
  }

  setValue(v: Value): this {
    this.sheet.put(this.r, this.c, v);
    return this;
  }

  setNumberFormat(f: string): this {
    this.sheet.formats.set(this.c, f);
    return this;
  }

  setDataValidation(rule: { values: string[] }): this {
    this.sheet.validation.set(this.c, rule.values);
    return this;
  }

  setFontWeight(): this {
    return this;
  }
}

class FakeSheet {
  cells: Value[][] = [];
  formats = new Map<number, string>();
  validation = new Map<number, string[]>();
  hidden = new Set<number>();
  frozen = 0;
  protections: { warningOnly: boolean; description: string }[] = [];

  constructor(public name: string) {}

  put(r: number, c: number, v: Value): void {
    while (this.cells.length < r) this.cells.push([]);
    const row = this.cells[r - 1] ?? [];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }

  getName = () => this.name;
  setName = (n: string) => {
    this.name = n;
    return this;
  };
  getLastRow = () => this.cells.filter((r) => r.some((v) => v !== '' && v !== null)).length;
  getLastColumn = () => Math.max(0, ...this.cells.map((r) => r.length));
  getMaxRows = () => 1000;
  /** A new Sheet's 26 columns (A to Z), or as many as were inserted. */
  maxColumns = 26;
  getMaxColumns = () => this.maxColumns;
  insertColumnsAfter = (after: number, n: number) => {
    expect(after).toBe(this.maxColumns);
    this.maxColumns += n;
  };
  getRange = (r: number, c: number, nr?: number, nc?: number) => new FakeRange(this, r, c, nr, nc);
  appendRow = (values: Value[]) => {
    this.cells.splice(this.getLastRow(), 0, [...values]);
    return this;
  };
  setFrozenRows = (n: number) => {
    this.frozen = n;
  };
  hideColumns = (c: number) => {
    this.hidden.add(c);
  };
  getProtections = () => this.protections;
  protect = () => {
    const p = { warningOnly: false, description: '' };
    this.protections.push(p);
    const api = {
      setDescription: (d: string) => {
        p.description = d;
        return api;
      },
      setWarningOnly: (w: boolean) => {
        p.warningOnly = w;
        return api;
      },
    };
    return api;
  };

  header(): string[] {
    return (this.cells[0] ?? []).map(String);
  }

  records(): Record<string, Value>[] {
    const [head = [], ...rows] = this.cells;
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [String(h), r[i] ?? ''])));
  }
}

interface Ui {
  context: 'sheet' | 'page';
  answers: string[];
  alerts: { title: string; prompt: string }[];
  dialogs: { title: string; output: Record<string, unknown> }[];
  menus: { name: string; items: [string, string][] }[];
}

/** The script's own time zone, from its manifest (Etc/UTC): a trigger's hour is in it unless it says another. */
const SCRIPT_TIME_ZONE = (
  JSON.parse(readFileSync(join(ACCESS_LIST_DIR, 'appsscript.json'), 'utf8')) as { timeZone: string }
).timeZone;

/** core.js and Code.js in one global scope, with Google's services made in memory. */
function appsScript(
  o: { context?: 'sheet' | 'page'; props?: Record<string, string>; sheetTimeZone?: string } = {},
) {
  const sheets: FakeSheet[] = [new FakeSheet('Sheet1')];
  const props = new Map(Object.entries(o.props ?? {}));
  const mails: { to: string; subject: string; body: string; name: string }[] = [];
  const counts = { propertyReads: 0, rsaCharsets: new Set<unknown>(), hmacCharsets: new Set<unknown>() };
  const ui: Ui = { context: o.context ?? 'sheet', answers: [], alerts: [], dialogs: [], menus: [] };
  const cache = new MemoryCache(() => Date.now());
  // The project's installable triggers (Session 55: the daily check), as ScriptApp keeps them.
  const triggers: { fn: string; days: number; hour: number | null; timeZone: string }[] = [];
  const Charset = { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' };
  const spreadsheet = {
    getSheetByName: (n: string) => sheets.find((s) => s.name === n) ?? null,
    getSheets: () => [...sheets],
    insertSheet: (n: string) => {
      const s = new FakeSheet(n);
      sheets.push(s);
      return s;
    },
    getSpreadsheetTimeZone: () => o.sheetTimeZone ?? 'Etc/UTC',
  };
  const Button = { OK: 'OK', CANCEL: 'CANCEL' };
  const getUi = () => {
    if (ui.context !== 'sheet') throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
    return {
      ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
      Button,
      alert: (title: string, prompt: string) => {
        ui.alerts.push({ title, prompt });
        return ui.answers.shift() ?? Button.OK;
      },
      showModalDialog: (output: Record<string, unknown>, title: string) => {
        ui.dialogs.push({ title, output });
      },
      createMenu: (name: string) => {
        const menu = { name, items: [] as [string, string][] };
        const api = {
          addItem: (caption: string, fn: string) => {
            menu.items.push([caption, fn]);
            return api;
          },
          addToUi: () => {
            ui.menus.push(menu);
          },
        };
        return api;
      },
    };
  };
  const output = (vars: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...vars };
    const api = {
      vars: out,
      setTitle: (t: string) => ((out['title'] = t), api),
      addMetaTag: (n: string, c: string) => ((out[`meta:${n}`] = c), api),
      setWidth: () => api,
      setHeight: () => api,
    };
    return api;
  };
  const google = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => undefined,
      getUi,
      ProtectionType: { SHEET: 'SHEET' },
      newDataValidation: () => {
        const rule = { values: [] as string[], allowInvalid: true };
        const api = {
          requireValueInList: (values: string[]) => ((rule.values = values), api),
          setAllowInvalid: (b: boolean) => ((rule.allowInvalid = b), api),
          build: () => rule,
        };
        return api;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => {
          counts.propertyReads++;
          return props.get(k) ?? null;
        },
        getProperties: () => {
          counts.propertyReads++;
          return Object.fromEntries(props);
        },
        setProperty: (k: string, v: string) => props.set(k, v),
        setProperties: (values: Record<string, string>) => {
          for (const [k, v] of Object.entries(values)) props.set(k, v);
        },
        deleteProperty: (k: string) => props.delete(k),
      }),
    },
    CacheService: { getScriptCache: () => cache },
    ScriptApp: {
      getProjectTriggers: () =>
        triggers.map((t) => ({ getHandlerFunction: () => t.fn, getEventType: () => 'CLOCK' })),
      newTrigger: (fn: string) => {
        const t = { fn, days: 0, hour: null as number | null, timeZone: SCRIPT_TIME_ZONE };
        const api = {
          timeBased: () => api,
          everyDays: (n: number) => ((t.days = n), api),
          atHour: (h: number) => ((t.hour = h), api),
          inTimezone: (zone: string) => ((t.timeZone = zone), api),
          create: () => {
            triggers.push(t);
            return { getHandlerFunction: () => t.fn };
          },
        };
        return api;
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    MailApp: {
      getRemainingDailyQuota: () => 100 - mails.length,
      sendEmail: (m: { to: string; subject: string; body: string; name: string }) => mails.push(m),
    },
    Utilities: {
      Charset,
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => randomUUID(),
      computeDigest: (alg: string, text: string, charset: string) => {
        expect(alg).toBe('SHA_256');
        return signed(
          createHash('sha256')
            .update(text, charset === Charset.UTF_8 ? 'utf8' : 'latin1')
            .digest(),
        );
      },
      computeHmacSha256Signature: (text: string, key: string, charset: unknown) => {
        counts.hmacCharsets.add(charset);
        return signed(createHmac('sha256', Buffer.from(key, 'utf8')).update(text, 'utf8').digest());
      },
      computeRsaSha256Signature: (text: string, pem: string, charset: unknown) => {
        counts.rsaCharsets.add(charset);
        return signed(sign('sha256', Buffer.from(text, 'utf8'), pem));
      },
      base64Encode: (bytes: number[]) => unsigned(bytes).toString('base64'),
      formatDate: (d: Date) => d.toISOString(),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text: string) => {
        const out = { text, mime: '', setMimeType: (m: string) => ((out.mime = m), out) };
        return out;
      },
    },
    HtmlService: {
      createTemplateFromFile: (name: string) => {
        const t: Record<string, unknown> = { file: name };
        t['evaluate'] = () => output(Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'evaluate')));
        return t;
      },
    },
    console: { error: () => undefined, log: () => undefined },
  };
  const context = createContext({ ...google }) as Record<string, unknown>;
  for (const file of ['core.js', 'Code.js'])
    runInContext(readFileSync(join(ACCESS_LIST_DIR, file), 'utf8'), context, { filename: file });
  const fn = (name: string, ...args: unknown[]): unknown =>
    (context[name] as (...a: unknown[]) => unknown)(...args);
  return { context, fn, sheets, props, mails, ui, counts, cache, triggers };
}

let keys: { pem: string; publicKey: string };
beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  keys = {
    pem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
});

const setUpProps = () => ({
  APPROVER_EMAIL: PLACEHOLDER_APPROVER,
  WEB_APP_URL: URL,
  SIGNING_KEY: keys.pem,
  PUBLIC_KEY: keys.publicKey,
  LINK_KEY: randomBytes(32).toString('hex'),
  SECRET_KEY: randomBytes(32).toString('hex'),
});

function post(g: ReturnType<typeof appsScript>, body: Record<string, unknown>) {
  const out = g.fn('doPost', {
    postData: { contents: JSON.stringify(body), type: 'text/plain' },
  }) as { text: string; mime: string };
  expect(out.mime).toBe('JSON');
  return readAnswer(JSON.parse(out.text) as { payload: string; sig: string }, keys.publicKey);
}

describe('the list in Apps Script', () => {
  it('answers Drashti through doPost, signed with the key kept in the script’s settings, as Drashti checks it', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    const computer = placeholderComputer('code-mac');
    const ask = callBody('request', computer, { gmail: PERSON, name: 'Placeholder Person' });
    expect(post(g, ask.body)).toMatchObject({
      ok: true,
      status: 'requested',
      nonce: ask.nonce,
      computerId: computer.id,
    });
    // The day's requests, counted in the script's settings (the cache keeps nothing 6 hours).
    expect(JSON.parse(g.props.get('REQUESTS_TODAY') ?? '{}') as unknown).toMatchObject({ n: 1 });
    expect(g.mails).toHaveLength(1);
    expect(g.mails[0]).toMatchObject({ to: PLACEHOLDER_APPROVER, name: 'Drashti access list' });
    expect(g.sheets.find((s) => s.name === 'Access List')?.records()[0]).toMatchObject({
      Gmail: PERSON,
      Status: 'requested',
    });
    // Every signature and HMAC asked of Google says its character set.
    expect([...g.counts.rsaCharsets]).toEqual(['UTF_8']);
    expect([...g.counts.hmacCharsets]).toEqual(['UTF_8']);
  });

  it('takes an Approve link to its page (one button), then its button, then lets the computer in', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    const computer = placeholderComputer('code-link');
    post(g, callBody('request', computer, { gmail: PERSON }).body);
    const approve = /Approve: (\S+)/u.exec(g.mails[0]?.body ?? '')?.[1] ?? '';
    expect(approve.startsWith(`${URL}?a=approve&`)).toBe(true);
    const page = g.fn('doGet', { parameter: linkParams(approve) }) as { vars: Record<string, unknown> };
    expect(page.vars['file']).toBe('Link');
    expect(page.vars['meta:viewport']).toContain('width=device-width');
    expect(page.vars['page']).toMatchObject({ kind: 'ready', button: 'Approve' });
    expect(g.fn('answerLink', linkParams(approve))).toMatchObject({ kind: 'done', title: 'Approved' });
    expect(g.fn('answerLink', linkParams(approve))).toMatchObject({ kind: 'used' });
    const token = /\b([0-9A-Z]{4}(?:-[0-9A-Z]{4}){6})\b/u.exec(g.mails[1]?.body ?? '')?.[1] ?? '';
    expect(g.mails[1]).toMatchObject({ to: PERSON, subject: 'Your Drashti token' });
    const r = post(g, callBody('redeem', computer, { gmail: PERSON, token }).body);
    expect(r).toMatchObject({ ok: true, owner: false });
    const grant = { gmail: PERSON, grantId: String(r['grantId']), secret: String(r['secret']) };
    expect(post(g, callBody('check', computer, { at: Date.now(), activity: {} }, grant).body)).toMatchObject({
      ok: true,
      status: 'in',
    });
    expect((g.fn('doGet', { parameter: {} }) as { text: string }).text).toContain('access list');
  });

  it('reads the script’s settings once, then from the cache', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    for (let i = 0; i < 5; i++)
      post(g, callBody('status', placeholderComputer(`code-${String(i)}`), { gmail: PERSON }).body);
    expect(g.counts.propertyReads).toBe(1);
  });

  it('makes the tabs and columns as core.js reads them, once, and puts back a column taken away', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    g.fn('prepareSheet_');
    const list = g.sheets.find((s) => s.name === 'Access List');
    const computers = g.sheets.find((s) => s.name === 'Computers');
    expect(g.sheets.map((s) => s.name)).toEqual(['Access List', 'Computers']);
    expect(list?.header().slice(0, 4)).toEqual(['Gmail', 'Name', 'Status', 'Requested']);
    expect(list?.header()).toHaveLength(25);
    expect(list?.header()[7]).toBe('Access ends');
    // The way each Gmail may use Drashti (Session 55), Pro or Simple only.
    expect(list?.header()[8]).toBe('Mode');
    expect(list?.validation.get(9)).toEqual(['Pro', 'Simple']);
    expect(computers?.header()).toHaveLength(18);
    expect(list?.validation.get(3)).toEqual(['requested', 'approved', 'rejected', 'revoked']);
    expect([...(list?.hidden ?? [])].sort((a, b) => a - b)).toEqual([19, 20, 21, 22, 23, 24, 25]);
    expect(list?.formats.get(4)).toBe('d mmm yyyy, h:mm');
    expect(list?.formats.get(8)).toBe('d mmm yyyy, h:mm');
    expect(computers?.protections).toEqual([
      { warningOnly: true, description: expect.stringContaining('access list') as unknown },
    ]);
    expect(list?.frozen).toBe(1);
    // Its Mode column made (Session 55 review): put back later, it comes back empty, which reads Simple.
    expect(g.props.get(core.MODE_MADE_PROPERTY)).toBe('1');
    list?.cells[0]?.splice(1, 1);
    g.fn('prepareSheet_');
    expect(list?.header().at(-1)).toBe('Name');
  });

  it('adds Access ends, Mode and Length to a Sheet set up before they came, by itself: after its last column, as Set up… would', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    const list = g.sheets.find((s) => s.name === 'Access List');
    if (!list) throw new Error('No Access List tab');
    // The Sheet as Set up… made it before lengths and modes came: 22 columns, the last 6 hidden, in a Sheet 22 wide.
    const gone = ['Access ends', 'Mode', 'Length'].map((h) => list.header().indexOf(h));
    list.cells = list.cells.map((r) => r.filter((_, i) => !gone.includes(i)));
    list.hidden = new Set([17, 18, 19, 20, 21, 22]);
    list.formats = new Map();
    list.validation = new Map([[3, ['requested', 'approved', 'rejected', 'revoked']]]);
    list.maxColumns = 22;
    g.props.delete(core.MODE_MADE_PROPERTY);
    const computer = placeholderComputer('code-old-sheet');
    expect(post(g, callBody('request', computer, { gmail: PERSON }).body)).toMatchObject({ ok: true });
    expect(list.header().slice(-3)).toEqual(['Access ends', 'Mode', 'Length']);
    expect(list.maxColumns).toBe(25);
    expect(list.formats.get(23)).toBe('d mmm yyyy, h:mm');
    expect(list.validation.get(24)).toEqual(['Pro', 'Simple']);
    expect(list.hidden.has(25)).toBe(true);
    expect(list.hidden.has(23)).toBe(false);
    expect(list.hidden.has(24)).toBe(false);
    expect(list.records()[0]).toMatchObject({
      Gmail: PERSON,
      Status: 'requested',
      'Access ends': '',
      Mode: 'Simple',
    });
    // Found, never added again.
    post(g, callBody('status', computer, { gmail: PERSON }).body);
    expect(list.header().filter((h) => h === 'Access ends')).toHaveLength(1);
  });

  it('Set up… on a Sheet from before modes came, with Gmails in it, leaves the Mode column to the list, which writes Pro for each one let in before (Session 55 review)', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    const list = g.sheets.find((s) => s.name === 'Access List');
    if (!list) throw new Error('No Access List tab');
    const computer = placeholderComputer('code-old-modes');
    post(g, callBody('request', computer, { gmail: PERSON }).body);
    const link = /Approve: (\S+)/u.exec(g.mails.at(-1)?.body ?? '')?.[1] ?? '';
    expect(g.fn('answerLink', { ...linkParams(link), mode: 'simple' })).toMatchObject({ kind: 'done' });
    // The Sheet as it was before modes came: no Mode column, and never one made.
    const mode = list.header().indexOf('Mode');
    list.cells = list.cells.map((r) => r.filter((_, i) => i !== mode));
    list.validation = new Map([[3, ['requested', 'approved', 'rejected', 'revoked']]]);
    g.props.delete(core.MODE_MADE_PROPERTY);
    // Set up… chosen again: the Mode column is not made empty under the Gmails already there…
    g.fn('prepareSheet_');
    expect(list.header()).not.toContain('Mode');
    // …the list makes it at its next call, Pro for the Gmail let in before modes came.
    g.cache.clear();
    post(g, callBody('status', computer, { gmail: PERSON }).body);
    expect(list.header().at(-1)).toBe('Mode');
    expect(list.records()[0]).toMatchObject({ Gmail: PERSON, Status: 'approved', Mode: 'Pro' });
    expect(g.props.get(core.MODE_MADE_PROPERTY)).toBe('1');
  });

  it('Set up…: asks for the approver first, then its window checks Google’s signing and keeps the keys once', () => {
    const none = appsScript();
    none.fn('drashtiSetUp');
    expect(none.ui.alerts[0]?.prompt).toContain('APPROVER_EMAIL');
    expect(none.ui.dialogs).toHaveLength(0);

    const g = appsScript({ props: { APPROVER_EMAIL: ` ${PLACEHOLDER_APPROVER} ` } });
    g.fn('drashtiSetUp');
    const vars = g.ui.dialogs[0]?.output['vars'] as Record<string, string>;
    expect(vars).toMatchObject({ file: 'Setup', approver: PLACEHOLDER_APPROVER, url: '', line: '' });
    const ticket = vars['ticket'] ?? '';
    expect(ticket).toMatch(/^[0-9a-f]{32}$/u);

    // The window's check: Google's signature, HMAC and SHA-256 against the browser's own.
    const text = `Drashti access list check ${randomBytes(16).toString('hex')}`;
    const hmacKey = randomBytes(32).toString('hex');
    const got = g.fn('drashtiTestKeys', ticket, { privatePem: keys.pem, text, hmacKey }) as {
      rsa: string;
      hmac: string;
      sha256: string;
    };
    expect(
      verify('sha256', Buffer.from(text), createPublicKey(keys.pem), Buffer.from(got.rsa, 'base64')),
    ).toBe(true);
    expect(got.hmac).toBe(createHmac('sha256', hmacKey).update(text).digest('hex'));
    expect(got.sha256).toBe(createHash('sha256').update(text).digest('hex'));
    expect(g.props.has('SIGNING_KEY')).toBe(false);

    const setup = {
      url: URL,
      privatePem: keys.pem,
      publicKey: keys.publicKey,
      linkKey: randomBytes(32).toString('hex'),
      secretKey: randomBytes(32).toString('hex'),
    };
    expect(() =>
      g.fn('drashtiSaveSetup', ticket, { ...setup, url: 'https://script.google.com/macros/s/x/dev' }),
    ).toThrow(/web app address/u);
    expect(g.fn('drashtiSaveSetup', ticket, setup)).toEqual({ line: `${URL}#key=${keys.publicKey}` });
    expect(g.props.get('SIGNING_KEY')).toBe(keys.pem);
    expect(g.props.has('SETUP_TICKET')).toBe(false);
    // Never twice: the ticket is spent, and the keys are never replaced.
    expect(() => g.fn('drashtiSaveSetup', ticket, setup)).toThrow(/run out/u);
    g.fn('drashtiSetUp');
    const again = g.ui.dialogs[1]?.output['vars'] as Record<string, string>;
    expect(again['line']).toBe(`${URL}#key=${keys.publicKey}`);
    expect(() => g.fn('drashtiSaveSetup', again['ticket'], setup)).toThrow(/never replaced/u);
  });

  it('Set up…’s ticket works only in its own window, and only for a while', () => {
    const g = appsScript({ props: { APPROVER_EMAIL: PLACEHOLDER_APPROVER } });
    g.fn('drashtiSetUp');
    const ticket = String((g.ui.dialogs[0]?.output['vars'] as Record<string, string>)['ticket']);
    const test = { privatePem: keys.pem, text: 'Placeholder check', hmacKey: '0'.repeat(64) };
    for (const wrong of ['', '0'.repeat(32), `${ticket}0`, 42, null])
      expect(() => g.fn('drashtiTestKeys', wrong, test)).toThrow(/run out/u);
    g.props.set('SETUP_TICKET', `${ticket} ${String(Date.now() - 1)}`);
    expect(() => g.fn('drashtiTestKeys', ticket, test)).toThrow(/run out/u);
  });

  it('Let me in (the owner)…: asks first, then emails the token to the approver’s own address', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    g.ui.answers.push('CANCEL');
    g.fn('drashtiLetMeIn');
    expect(g.mails).toHaveLength(0);
    g.fn('drashtiLetMeIn');
    expect(g.mails).toHaveLength(1);
    expect(g.mails[0]).toMatchObject({ to: PLACEHOLDER_APPROVER, subject: 'Your Drashti token' });
    expect(g.ui.alerts.at(-1)?.title).toBe('Token sent');
    g.fn('onOpen');
    expect(g.ui.menus).toEqual([
      {
        name: 'Drashti',
        items: [
          ['Set up…', 'drashtiSetUp'],
          ['Let me in (the owner)…', 'drashtiLetMeIn'],
          ['Turn on the daily check…', 'drashtiDailyOn'],
        ],
      },
    ]);
  });

  it('Turn on the daily check…: asks first, then makes one time-driven trigger a day for drashtiDailyCheck; asked again, says it is on and makes no second', () => {
    // The Sheet's time zone is not the script's (Etc/UTC): "about 3 in the morning" is the Sheet's 3, as it says.
    const g = appsScript({ props: setUpProps(), sheetTimeZone: 'Asia/Kolkata' });
    expect(SCRIPT_TIME_ZONE).toBe('Etc/UTC');
    g.fn('prepareSheet_');
    g.ui.answers.push('CANCEL');
    g.fn('drashtiDailyOn');
    expect(g.triggers).toHaveLength(0);
    expect(g.ui.alerts.at(-1)?.prompt).toContain('15 days');
    expect(g.ui.alerts.at(-1)?.prompt).toContain('Every day at about 3 in the morning');
    g.fn('drashtiDailyOn');
    expect(g.triggers).toEqual([{ fn: 'drashtiDailyCheck', days: 1, hour: 3, timeZone: 'Asia/Kolkata' }]);
    expect(g.ui.alerts.at(-1)?.title).toBe('The daily check is on');
    g.fn('drashtiDailyOn');
    expect(g.triggers).toHaveLength(1);
    expect(g.ui.alerts.at(-1)?.prompt).toContain('already');
  });

  it('the daily check ends each computer with no check for 15 days, by the list’s clock, and only once in 10 minutes', () => {
    const g = appsScript({ props: setUpProps() });
    g.fn('prepareSheet_');
    const computer = placeholderComputer('code-daily');
    post(g, callBody('request', computer, { gmail: PERSON }).body);
    const link = /Approve: (\S+)/u.exec(g.mails.at(-1)?.body ?? '')?.[1] ?? '';
    expect(g.fn('answerLink', { ...linkParams(link), mode: 'pro' })).toMatchObject({ kind: 'done' });
    const token = /\b([0-9A-Z]{4}(?:-[0-9A-Z]{4}){6})\b/u.exec(g.mails.at(-1)?.body ?? '')?.[1] ?? '';
    expect(post(g, callBody('redeem', computer, { gmail: PERSON, token }).body)).toMatchObject({ ok: true });
    const computers = g.sheets.find((s) => s.name === 'Computers');
    if (!computers) throw new Error('No Computers tab');
    const col = (h: string) => computers.header().indexOf(h) + 1;
    // Its last check 16 days ago: the daily check ends it.
    const long = new Date(Date.now() - 16 * 24 * 3_600_000);
    computers.put(2, col('Last seen'), long);
    computers.put(2, col('Token used'), long);
    // It returns nothing (Session 55 review: called by name from a page, it says nothing about the list).
    expect(g.fn('drashtiDailyCheck')).toBeUndefined();
    expect(computers.records()[0]).toMatchObject({ 'Why ended': 'no-contact' });
    expect(g.fn('drashtiDailyCheck')).toBeUndefined();
  });

  it('asks Google for the one scope a trigger needs, beside the three it had', () => {
    const manifest = JSON.parse(readFileSync(join(ACCESS_LIST_DIR, 'appsscript.json'), 'utf8')) as {
      oauthScopes: string[];
    };
    expect(manifest.oauthScopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets.currentonly',
      'https://www.googleapis.com/auth/script.send_mail',
      'https://www.googleapis.com/auth/script.container.ui',
      'https://www.googleapis.com/auth/script.scriptapp',
    ]);
  });

  it('can be called by name from a web page only where that is safe', () => {
    const g = appsScript({ context: 'page', props: { APPROVER_EMAIL: PLACEHOLDER_APPROVER } });
    const callable = Object.keys(g.context)
      .filter((k) => typeof g.context[k] === 'function' && !k.endsWith('_'))
      .sort();
    expect(callable).toEqual([
      'answerLink',
      'doGet',
      'doPost',
      'drashtiDailyCheck',
      'drashtiDailyOn',
      'drashtiLetMeIn',
      'drashtiSaveSetup',
      'drashtiSetUp',
      'drashtiTestKeys',
      'onOpen',
    ]);
    expect(typeof g.context['DrashtiAccess']).toBe('object');
    // Outside the Sheet's own window, the menu's three do nothing at all.
    expect(() => g.fn('drashtiSetUp')).toThrow(/getUi/u);
    expect(() => g.fn('drashtiLetMeIn')).toThrow(/getUi/u);
    expect(() => g.fn('drashtiDailyOn')).toThrow(/getUi/u);
    expect(g.triggers).toHaveLength(0);
    // The daily check called by name does only what the daily check does (here, with nothing set up, nothing).
    expect(g.fn('drashtiDailyCheck')).toBeUndefined();
    expect(g.props.has('SETUP_TICKET')).toBe(false);
    expect(g.sheets.map((s) => s.name)).toEqual(['Sheet1']);
    expect(g.mails).toHaveLength(0);
    // The window's calls need its ticket; a link's button needs a signed link.
    expect(() => g.fn('drashtiTestKeys', '', {})).toThrow(/run out/u);
    expect(() => g.fn('drashtiSaveSetup', '', {})).toThrow(/run out/u);
    expect(
      g.fn('answerLink', { a: 'approve', r: '0'.repeat(32), x: '9'.repeat(13), s: '0'.repeat(64) }),
    ).toMatchObject({
      kind: 'not-set-up',
    });
  });
});

describe('Drashti’s installers', () => {
  it('never carry the list’s code or the tests’ stand-in', () => {
    const yml = readFileSync(join(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8');
    const block = /^files:\n((?: {2}(?:- |#).*\n)+)/mu.exec(yml)?.[1] ?? '';
    const files = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '));
    expect(files).toEqual([
      '- out/**/*',
      '- package.json',
      "- '!node_modules/better-sqlite3/{deps,src,build}/**'",
      "- '!node_modules/better-sqlite3/prebuilds/linux*'",
    ]);
    // The guides' pictures are named for the windows they show: screenshots/access-list.png is the Access List's.
    const withoutPictures = yml.replace(/^ *- screenshots\/[a-z0-9-]+\.png\n/gmu, '');
    expect(withoutPictures).toContain('from: docs');
    expect(withoutPictures).not.toMatch(/access-list|tests\//u);
  });
});
